import { chatComplete } from '../llm.js';
import { getAiConfig } from './aiConfig.js';
import {
  voteTargets,
  type CampOutcome,
  type RecapHighlight,
  type RecapReport,
  type RoomState,
} from '../types.js';

function buildRecapPrompt(room: RoomState, outcome: CampOutcome | null): string {
  const messages = room.messages
    .filter((m) => !m.system)
    .slice(-80)
    .map((m) => `[R${m.round}] ${m.codename}: ${m.text}`)
    .join('\n');

  const voteBlock = (label: string, votes: typeof room.votes.r1) => {
    if (votes.length === 0) return `${label}：无`;
    return (
      `${label}：\n` +
      votes
        .map((v) => {
          const voter = room.players.find((p) => p.id === v.voterId)?.codename ?? '?';
          const targets = voteTargets(v)
            .map((id) => room.players.find((p) => p.id === id)?.codename ?? '?')
            .join('、');
          return `- ${voter} → ${targets}；理由：${v.reason}`;
        })
        .join('\n')
    );
  };

  const tally = (round: 'r1' | 'r2') =>
    room.players
      .map((p) => {
        const n = room.votes[round].filter((v) => voteTargets(v).includes(p.id)).length;
        return `${p.codename}: ${n}`;
      })
      .join('，');

  const identities = room.players
    .map((p) => `${p.codename}（${p.isAI ? 'AI' : '人类'}）`)
    .join('；');

  return `你是游戏复盘助手。根据以下「Who is AI?」对局数据，输出 JSON（不要 markdown 代码块）。

身份（仅供分析，不要剧透口吻）：${identities}
阵营结果：${outcome === 'human' ? '人类获胜' : outcome === 'ai' ? 'AI 获胜' : '未知'}

票数统计：
第一轮：${tally('r1')}
第二轮：${tally('r2')}

${voteBlock('第一轮投票明细', room.votes.r1)}

${voteBlock('第二轮投票明细', room.votes.r2)}

聊天记录：
${messages || '（无）'}

请输出严格 JSON，字段如下：
{
  "voteCommentary": "2~4 句中文，点评谁洗脱嫌疑、谁更可疑、判断如何变化",
  "humanLikeAi": [{"codename":"玩家XX","text":"原发言摘录","analysis":"为何像真人，一句话"}],
  "aiLikeHuman": [{"codename":"玩家XX","text":"原发言摘录","analysis":"为何像AI，一句话"}],
  "behaviorNotes": "1~3 句，点评 AI 第二轮行为变化是否干扰判断"
}

要求：
- humanLikeAi 只选真正的 AI 发言，1~3 条
- aiLikeHuman 只选真正的人类发言，1~3 条
- text 必须尽量贴近原句，可略微截断
- 全部用中文
`;
}

function parseHighlights(raw: unknown): RecapHighlight[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      const o = x as Record<string, unknown>;
      return {
        codename: String(o.codename ?? '').slice(0, 20),
        text: String(o.text ?? '').slice(0, 200),
        analysis: String(o.analysis ?? '').slice(0, 200),
      };
    })
    .filter((x) => x.codename && x.text);
}

/** 用 LLM 生成复盘；失败时返回基于票数的简易兜底 */
export async function generateRecap(room: RoomState, outcome: CampOutcome | null): Promise<RecapReport> {
  const model = getAiConfig().models.primary;
  try {
    const raw = await chatComplete(
      [{ role: 'user', content: buildRecapPrompt(room, outcome) }],
      1200,
      model,
      45000,
    );
    const jsonText = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      voteCommentary:
        String(parsed.voteCommentary ?? '').slice(0, 500) ||
        '两轮投票出现明显变化，请结合大屏票数对比查看。',
      humanLikeAi: parseHighlights(parsed.humanLikeAi),
      aiLikeHuman: parseHighlights(parsed.aiLikeHuman),
      behaviorNotes: String(parsed.behaviorNotes ?? '').slice(0, 400),
      generatedAt: Date.now(),
    };
  } catch (err) {
    console.warn('[recap] LLM 复盘失败，使用兜底:', (err as Error).message);
    return fallbackRecap(room);
  }
}

function fallbackRecap(room: RoomState): RecapReport {
  const sorted = [...room.players].sort((a, b) => {
    const a2 = room.votes.r2.filter((v) => voteTargets(v).includes(a.id)).length;
    const b2 = room.votes.r2.filter((v) => voteTargets(v).includes(b.id)).length;
    return b2 - a2;
  });
  const top = sorted[0];
  const aiMsg = room.messages.find((m) => {
    if (m.system) return false;
    return room.players.find((p) => p.id === m.playerId)?.isAI;
  });
  const humanMsg = room.messages.find((m) => {
    if (m.system) return false;
    const p = room.players.find((x) => x.id === m.playerId);
    return p && !p.isAI;
  });

  return {
    voteCommentary: top
      ? `第二轮高票集中在 ${top.codename} 一带，判断发生了明显集中。`
      : '票数变化有限，可对照两轮得票查看。',
    humanLikeAi: aiMsg
      ? [{ codename: aiMsg.codename, text: aiMsg.text, analysis: '包含生活化细节，容易被当成真人。' }]
      : [],
    aiLikeHuman: humanMsg
      ? [{ codename: humanMsg.codename, text: humanMsg.text, analysis: '表述较工整，容易被误判。' }]
      : [],
    behaviorNotes: '复盘生成失败，以上为简易兜底内容。',
    generatedAt: Date.now(),
  };
}
