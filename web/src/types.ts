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

export const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: '等待大厅',
  RULES: '规则讲解',
  ROUND1_CHAT: '第一轮聊天',
  ROUND1_VOTE: '第一轮投票',
  INTERMISSION: '中场：系统调整中',
  ROUND2_CHAT: '第二轮聊天',
  ROUND2_VOTE: '最终投票',
  REVEAL: '揭晓时刻',
};

export const PHASE_ORDER: Phase[] = [
  'LOBBY',
  'RULES',
  'ROUND1_CHAT',
  'ROUND1_VOTE',
  'INTERMISSION',
  'ROUND2_CHAT',
  'ROUND2_VOTE',
  'REVEAL',
];

export interface PublicPlayer {
  id: string;
  codename: string;
  connected: boolean;
  isAI: boolean | null;
  realName: string | null;
  revealed: boolean;
}

export interface ChatMessage {
  id: string;
  roomId: RoomId;
  playerId: string;
  codename: string;
  text: string;
  round: 1 | 2;
  mentions: string[];
  system: boolean;
  ts: number;
}

export interface Vote {
  voterId: string;
  targetId: string;
  reason: string;
  ts: number;
}

export interface PublicState {
  now: number;
  phase: Phase;
  phaseEndsAt: number | null;
  room: {
    id: RoomId;
    title: string;
    mainQuestion: string;
    players: PublicPlayer[];
    playerCount: number;
    messages: ChatMessage[];
    votedCount: number;
  };
  limits: { maxMsgsPerRound: number };
  usage: Record<string, { msgs: number; mentionUsed2: boolean }>;
}

export interface HostPlayer {
  id: string;
  codename: string;
  realName: string;
  isAI: boolean;
  persona: { name: string; background: string; style: string } | null;
  connected: boolean;
  revealed: boolean;
  votesR1: number;
  votesR2: number;
}

export interface HostRoom {
  id: RoomId;
  title: string;
  mainQuestion: string;
  players: HostPlayer[];
  messages: ChatMessage[];
  votes: { r1: Vote[]; r2: Vote[] };
}

export interface AwardEntry {
  codename: string;
  realName: string;
  roomId: RoomId;
  score?: number;
  votes?: number;
}

export interface PersonaCfg {
  name: string;
  background: string;
  style: string;
}

export interface AiPromptsCfg {
  baseRules: string;
  roomContextTech: string;
  roomContextLife: string;
  strategyHigh: string;
  strategyLow: string;
  strategyMid: string;
  strategyNone: string;
}

export interface AdminData {
  config: {
    personas: Record<RoomId, PersonaCfg[]>;
    prompts: AiPromptsCfg;
    mainQuestions: Record<RoomId, string>;
    models: { baseUrl: string; apiKey: string; primary: string; fallback: string };
  };
  domainNotes: Record<RoomId, string>;
  modelList: string[];
}

export interface HostState {
  now: number;
  phase: Phase;
  phaseEndsAt: number | null;
  codenamesAssigned: boolean;
  rooms: HostRoom[];
  awards: { detectives: AwardEntry[]; actors: AwardEntry[]; ais: AwardEntry[] };
}
