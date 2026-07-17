export type Phase =
  | 'LOBBY'
  | 'RULES'
  | 'ROUND1_CHAT'
  | 'ROUND1_VOTE'
  | 'INTERMISSION'
  | 'ROUND2_CHAT'
  | 'ROUND2_VOTE'
  | 'REVEAL';

/** 美食 / 旅游（每局只启用其中一个） */
export type RoomId = 'food' | 'travel';

export interface Persona {
  name: string;
  background: string;
  style: string;
}

export interface Player {
  id: string;
  token: string;
  roomId: RoomId;
  /** 公开代号，如 玩家01；LOBBY 阶段为空，开局时统一分配 */
  codename: string;
  /** 玩家自己输入的名字，仅主持人可见 */
  realName: string;
  /** 从 URL ?userid= 传入的真实用户 ID（如 jeffery.zhao），AI 为空字符串 */
  userId: string;
  isAI: boolean;
  persona?: Persona;
  /** AI 使用的模型名；人类玩家为空字符串 */
  model: string;
  connected: boolean;
  revealed: boolean;
}

export interface ChatMessage {
  id: string;
  roomId: RoomId;
  playerId: string; // 系统消息为空字符串
  codename: string;
  text: string;
  round: 1 | 2;
  mentions: string[]; // 被 @ 的 player id
  system: boolean;
  ts: number;
}

export interface Vote {
  voterId: string;
  /** 第一轮 1 人；第二轮 1～2 人 */
  targetIds: string[];
  reason: string;
  ts: number;
}

export interface PlayerUsage {
  msgs1: number;
  msgs2: number;
  mentionUsed2: boolean;
  lastMsgTs: number;
}

export interface RoomState {
  id: RoomId;
  title: string;
  mainQuestion: string;
  players: Player[];
  messages: ChatMessage[];
  votes: { r1: Vote[]; r2: Vote[] };
}

/** LLM 生成的复盘报告 */
export interface RecapHighlight {
  codename: string;
  text: string;
  analysis: string;
}

export interface RecapReport {
  voteCommentary: string;
  humanLikeAi: RecapHighlight[];
  aiLikeHuman: RecapHighlight[];
  behaviorNotes: string;
  generatedAt: number;
}

export type CampOutcome = 'human' | 'ai';

export interface GameState {
  phase: Phase;
  phaseEndsAt: number | null;
  /** 本局启用的房间：每局游戏只玩其中一个聊天室 */
  activeRoom: RoomId;
  /** 人类玩家人数上限（主持人可配置） */
  maxHumans: number;
  rooms: Record<RoomId, RoomState>;
  usage: Record<string, PlayerUsage>;
  codenamesAssigned: boolean;
  /** 最终阵营胜负；揭晓阶段计算 */
  outcome: CampOutcome | null;
  /** LLM 复盘；揭晓阶段异步生成 */
  recap: RecapReport | null;
}

/** 默认 AI 模型：第 1 个 / 第 2 个 */
export const DEFAULT_AI_MODELS = ['claude-opus-4.6', 'gpt-5.5'] as const;
export const DEFAULT_MAX_HUMANS = 10;

export function voteTargets(v: Vote & { targetId?: string }): string[] {
  if (Array.isArray(v.targetIds) && v.targetIds.length > 0) return v.targetIds;
  if (v.targetId) return [v.targetId];
  return [];
}
