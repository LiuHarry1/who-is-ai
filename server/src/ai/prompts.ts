import type { ChatMessage, Persona, RoomState } from '../types.js';
import type { LlmMessage } from '../llm.js';
import { domainNotes } from './domainNotes.js';
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

/** 房间听众背景 + 领域素材：决定 AI 说话的"行话浓度"和分寸 */
function roomContext(room: RoomState): string {
  const p = getAiConfig().prompts;
  let out = '';
  const ctx = room.id === 'tech' ? p.roomContextTech : p.roomContextLife;
  if (ctx) out += '\n' + ctx;
  const notes = domainNotes(room.id);
  if (notes) {
    out +=
      '\n以下是给你参考的领域素材（真实的行话和典型经历，可以当作自己的经历改编着用）。' +
      '注意：别照抄原句，一条消息里最多用到一个点，大部分发言可以完全不用它：\n---\n' +
      notes +
      '\n---';
  }
  return out;
}

function systemPrompt(room: RoomState, codename: string, persona: Persona, extra = ''): string {
  return getAiConfig().prompts.baseRules + '\n' + personaText(codename, persona) + roomContext(room) + extra;
}

/** 第一轮主问题的回答（可在规则讲解阶段预生成） */
export function buildMainAnswerPrompt(
  room: RoomState,
  codename: string,
  persona: Persona,
): LlmMessage[] {
  return [
    { role: 'system', content: systemPrompt(room, codename, persona) },
    {
      role: 'user',
      content: `聊天室主题是「${room.title}」。主持人的主问题是：「${room.mainQuestion}」。
以你的人设随手答一下这个问题，就像微信群里被点名回答时那样：
一两句话（15~35 字），可以提一个具体的小事但别展开讲成故事，可以平淡一点，不要写得精彩。`,
    },
  ];
}

/** 常规回复：根据最近聊天记录接话 */
export function buildReplyPrompt(
  room: RoomState,
  codename: string,
  persona: Persona,
  suspicion: Suspicion,
  trigger: ChatMessage | null,
): LlmMessage[] {
  const history = historyText(room, codename);
  const triggerNote = trigger
    ? trigger.mentions.length > 0
      ? `刚才「${trigger.codename}」@了你，问：「${trigger.text}」。你必须回应这条消息。`
      : `最新一条消息来自「${trigger.codename}」：「${trigger.text}」。你可以回应它，也可以接群里正在聊的话题。`
    : '现在群里有点安静，你可以主动说点什么，接之前的话题或者抛个新的相关话题。';

  return [
    {
      role: 'system',
      content: systemPrompt(room, codename, persona, '\n' + strategyText(suspicion)),
    },
    {
      role: 'user',
      content: `聊天室主题是「${room.title}」。以下是最近的聊天记录：
---
${history}
---
${triggerNote}
请输出你要发的一条消息（只输出内容本身）。`,
    },
  ];
}

/** 输出净化：去引号、去代号前缀、去乱码/emoji、限长、按需去掉 @ */
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
  // 按码点截断，避免劈开代理对再次产生乱码
  const chars = Array.from(t);
  if (chars.length > 100) t = chars.slice(0, 100).join('');
  return t.trim();
}
