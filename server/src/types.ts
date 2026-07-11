export type Phase =
  | 'LOBBY'
  | 'RULES'
  | 'ROUND1_CHAT'
  | 'ROUND1_VOTE'
  | 'INTERMISSION'
  | 'ROUND2_CHAT'
  | 'ROUND2_VOTE'
  | 'REVEAL';

export type RoomId = 'tech' | 'life';

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
  /** 真实姓名，仅主持人可见 */
  realName: string;
  isAI: boolean;
  persona?: Persona;
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
  targetId: string;
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

export interface GameState {
  phase: Phase;
  phaseEndsAt: number | null;
  rooms: Record<RoomId, RoomState>;
  usage: Record<string, PlayerUsage>;
  codenamesAssigned: boolean;
}
