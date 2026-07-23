import type { ChatMessage, Persona, RoomState } from '../types.js';
import type { LlmMessage } from '../llm.js';
import { domainNotes } from './domainNotes.js';
import { sampleChatCorpus } from './chatCorpus.js';
import { getAiConfig } from './aiConfig.js';

export type Suspicion = 'high' | 'low' | 'mid' | 'none';

function strategyText(s: Suspicion): string {
  const p = getAiConfig().prompts;
  switch (s) {
    case 'high':
      return p.strategyHigh;
    case 'low':
      return p.strategyLow;
    case 'mid':
      return p.strategyMid;
    default:
      return p.strategyNone;
  }
}

function historyText(room: RoomState, selfCodename: string, limit = 30): string {
  return room.messages
    .slice(-limit)
    .map((m) => {
      const who = m.system ? '[主持人]' : m.codename === selfCodename ? `${m.codename}(你自己)` : m.codename;
      return `${who}: ${m.text}`;
    })
    .join('\n');
}

function personaText(codename: string, persona: Persona): string {
  return `你的人设：
- 聊天室里你的代号是「${codename}」（别人只能看到代号）
- 背景：${persona.background}
- 说话风格：${persona.style}`;
}

/** 房间背景；领域素材仅在需要答主问题等场景注入，避免跑题时硬聊主题 */
function roomContext(room: RoomState, includeDomainNotes: boolean): string {
  const p = getAiConfig().prompts;
  let out = '';
  const ctx = room.id === 'food' ? p.roomContextFood : p.roomContextTravel;
  if (ctx) out += '\n' + ctx;
  if (includeDomainNotes) {
    const notes = domainNotes(room.id);
    if (notes) {
      out +=
        '\n以下是可选领域素材（仅当群里正在聊主题时才可借用一点；跑题时完全不要用）：\n---\n' +
        notes +
        '\n---';
    }
  }
  return out;
}

function systemPrompt(
  room: RoomState,
  codename: string,
  persona: Persona,
  extra = '',
  includeDomainNotes = false,
): string {
  const corpus = sampleChatCorpus(room.id);
  return (
    getAiConfig().prompts.baseRules +
    '\n' +
    personaText(codename, persona) +
    roomContext(room, includeDomainNotes) +
    corpus +
    extra
  );
}

/** 第一轮主问题的短答（可选；群里已跑题时调度器可能根本不发） */
export function buildMainAnswerPrompt(
  room: RoomState,
  codename: string,
  persona: Persona,
): LlmMessage[] {
  return [
    { role: 'system', content: systemPrompt(room, codename, persona, '', true) },
    {
      role: 'user',
      content: `聊天室主题是「${room.title}」。主持人的主问题是：「${room.mainQuestion}」。
像微信群被点到时随手回一句，一般不超过 12 个字，平淡即可，不要故事、不要小作文。`,
    },
  ];
}

/** 常规回复：紧贴最近聊天记录 */
export function buildReplyPrompt(
  room: RoomState,
  codename: string,
  persona: Persona,
  suspicion: Suspicion,
  trigger: ChatMessage | null,
): LlmMessage[] {
  const history = historyText(room, codename);
  const mentioned = Boolean(trigger && trigger.mentions.length > 0);
  const triggerNote = trigger
    ? mentioned
      ? `刚才「${trigger.codename}」提到了你：「${trigger.text}」。你可以短回一句，也可以当没看见（真人也常不理）。若回，语调要贴聊天记录，别认真答题。`
      : `最新一条来自「${trigger.codename}」：「${trigger.text}」。顺着群里正在聊的接一句即可；群里没聊主题就别硬扯主题。`
    : '群里有点安静。若要开口，接刚才别人提到的点说一句短的；别突然抛一大段主题经历。';

  const ownRecent = room.messages
    .filter((m) => !m.system && m.codename === codename)
    .slice(-4)
    .map((m) => `- ${m.text}`)
    .join('\n');
  const antiRepeat = ownRecent
    ? `\n你自己之前已经说过这些（不要重复观点或句式）：\n${ownRecent}`
    : '';

  return [
    {
      role: 'system',
      content: systemPrompt(room, codename, persona, '\n' + strategyText(suspicion), false),
    },
    {
      role: 'user',
      content: `以下是最近的聊天记录（语调、长短、话题都要跟着它走）：
---
${history}
---
${triggerNote}${antiRepeat}
请输出你要发的一条消息（只输出内容本身），一般不超过 12 个字。`,
    },
  ];
}

/** 输出净化：去引号、去代号前缀、去乱码/emoji、限长、按需去掉 @（不做 12 字硬截断） */
export function sanitizeOutput(text: string, stripMentions: boolean): string {
  let t = text.trim();
  t = t.replace(/^["'“”]+|["'“”]+$/g, '');
  t = t.replace(/^(玩家\d+|我)[:：]\s*/, '');
  if (stripMentions) t = t.replace(/@\S+\s?/g, '');
  // 只取第一段，避免模型输出多段长文
  t = t.split('\n')[0];
  // 去掉乱码替换符和 emoji（乱码"�"会直接暴露不是人）
  t = t.replace(/\uFFFD/g, '');
  t = t.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');
  // 按码点截断，避免劈开代理对再次产生乱码（软上限，非 12 字硬截断）
  const chars = Array.from(t);
  if (chars.length > 100) t = chars.slice(0, 100).join('');
  return t.trim();
}
