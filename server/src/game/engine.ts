import { EventEmitter } from 'node:events';
import { randomUUID, randomBytes } from 'node:crypto';
import type {
  ChatMessage,
  GameState,
  Persona,
  Phase,
  Player,
  PlayerUsage,
  RoomId,
  RoomState,
  Vote,
} from '../types.js';

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

/** 各阶段倒计时秒数；没有配置的阶段由主持人手动推进 */
const PHASE_DURATION: Partial<Record<Phase, number>> = {
  ROUND1_CHAT: 300,
  ROUND1_VOTE: 180,
  ROUND2_CHAT: 300,
  ROUND2_VOTE: 180,
};

/** 倒计时结束后自动进入下一阶段的阶段 */
const AUTO_ADVANCE = new Set<Phase>(['ROUND1_CHAT', 'ROUND1_VOTE', 'ROUND2_CHAT', 'ROUND2_VOTE']);

const CHAT_PHASES = new Set<Phase>(['ROUND1_CHAT', 'ROUND2_CHAT']);
const VOTE_PHASES = new Set<Phase>(['ROUND1_VOTE', 'ROUND2_VOTE']);

const MAX_MSGS_PER_ROUND = 5;
const MIN_MSG_INTERVAL_MS = 2000;
const MAX_MSG_LEN = 200;
const MAX_HUMANS_PER_ROOM = 15;

export function roundOf(phase: Phase): 1 | 2 {
  return phase.startsWith('ROUND2') ? 2 : 1;
}

function freshRoom(id: RoomId): RoomState {
  return {
    id,
    title: id === 'tech' ? '技术聊天室' : '生活聊天室',
    mainQuestion:
      id === 'tech' ? '你印象最深的一次 debug 经历是什么？' : '最近有什么开心的事情？',
    players: [],
    messages: [],
    votes: { r1: [], r2: [] },
  };
}

function freshState(activeRoom: RoomId = 'tech'): GameState {
  return {
    phase: 'LOBBY',
    phaseEndsAt: null,
    activeRoom,
    rooms: { tech: freshRoom('tech'), life: freshRoom('life') },
    usage: {},
    codenamesAssigned: false,
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * 服务端权威游戏状态机。
 * 事件：'change'（任何状态变化）、'message'（新聊天消息）、'phase'（阶段切换）
 */
export class GameEngine extends EventEmitter {
  state: GameState = freshState();
  private timer: NodeJS.Timeout | null = null;

  loadState(s: GameState) {
    // 兼容没有 activeRoom 字段的旧快照
    if (!s.activeRoom) s.activeRoom = 'tech';
    this.state = s;
    // 重启后所有连接都断了
    for (const room of Object.values(this.state.rooms)) {
      for (const p of room.players) if (!p.isAI) p.connected = false;
    }
    this.armTimer();
  }

  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state = freshState(this.state.activeRoom);
    this.emit('phase', this.state.phase);
    this.emit('change');
  }

  /** 切换本局启用的房间，仅允许在大厅阶段（此时还没人开始玩） */
  setActiveRoom(roomId: RoomId): ActionResult {
    if (this.state.phase !== 'LOBBY') return { ok: false, error: '只能在大厅阶段切换房间' };
    if (this.state.activeRoom === roomId) return { ok: true };
    const humans = this.activeRoomState().players.filter((p) => !p.isAI);
    if (humans.length > 0) return { ok: false, error: '当前房间已有玩家加入，请先重置游戏' };
    this.state.activeRoom = roomId;
    this.emit('activeRoomChanged', roomId);
    this.emit('change');
    return { ok: true };
  }

  activeRoomState(): RoomState {
    return this.state.rooms[this.state.activeRoom];
  }

  // ---------- 查询 ----------

  findPlayer(playerId: string): Player | undefined {
    for (const room of Object.values(this.state.rooms)) {
      const p = room.players.find((x) => x.id === playerId);
      if (p) return p;
    }
    return undefined;
  }

  findByToken(token: string): Player | undefined {
    for (const room of Object.values(this.state.rooms)) {
      const p = room.players.find((x) => x.token === token);
      if (p) return p;
    }
    return undefined;
  }

  room(roomId: RoomId): RoomState {
    return this.state.rooms[roomId];
  }

  usageOf(playerId: string): PlayerUsage {
    let u = this.state.usage[playerId];
    if (!u) {
      u = { msgs1: 0, msgs2: 0, mentionUsed2: false, lastMsgTs: 0 };
      this.state.usage[playerId] = u;
    }
    return u;
  }

  votesFor(playerId: string, round: 1 | 2): number {
    const p = this.findPlayer(playerId);
    if (!p) return 0;
    const votes = round === 1 ? this.room(p.roomId).votes.r1 : this.room(p.roomId).votes.r2;
    return votes.filter((v) => v.targetId === playerId).length;
  }

  // ---------- 加入 / 重连 ----------

  join(roomId: RoomId, realName: string): { ok: boolean; error?: string; player?: Player } {
    const room = this.state.rooms[roomId];
    if (!room) return { ok: false, error: '房间不存在' };
    if (roomId !== this.state.activeRoom) {
      return { ok: false, error: `本局游戏在「${this.activeRoomState().title}」进行，请从首页重新进入` };
    }
    if (this.state.phase === 'REVEAL') return { ok: false, error: '游戏已结束' };
    const humans = room.players.filter((p) => !p.isAI);
    if (humans.length >= MAX_HUMANS_PER_ROOM) return { ok: false, error: '房间已满' };
    const name = realName.trim().slice(0, 20);
    if (!name) return { ok: false, error: '请输入姓名' };
    if (humans.some((p) => p.realName === name)) return { ok: false, error: '这个名字已被使用' };

    const player: Player = {
      id: randomUUID(),
      token: randomBytes(16).toString('hex'),
      roomId,
      codename: this.state.codenamesAssigned ? this.nextCodename(room) : '',
      realName: name,
      isAI: false,
      connected: true,
      revealed: false,
    };
    room.players.push(player);
    this.emit('change');
    return { ok: true, player };
  }

  setConnected(playerId: string, connected: boolean) {
    const p = this.findPlayer(playerId);
    if (p && !p.isAI && p.connected !== connected) {
      p.connected = connected;
      this.emit('change');
    }
  }

  // ---------- AI 管理 ----------

  addAI(roomId: RoomId, persona: Persona): Player {
    const room = this.state.rooms[roomId];
    const player: Player = {
      id: randomUUID(),
      token: randomBytes(16).toString('hex'),
      roomId,
      codename: this.state.codenamesAssigned ? this.nextCodename(room) : '',
      realName: `AI·${persona.name}`,
      isAI: true,
      persona,
      connected: true,
      revealed: false,
    };
    room.players.push(player);
    this.emit('change');
    this.emit('aiAdded', player);
    return player;
  }

  removeAI(roomId: RoomId): boolean {
    const room = this.state.rooms[roomId];
    const idx = room.players.findLastIndex((p) => p.isAI);
    if (idx < 0) return false;
    const [removed] = room.players.splice(idx, 1);
    this.emit('aiRemoved', removed);
    this.emit('change');
    return true;
  }

  // ---------- 阶段控制 ----------

  private nextCodename(room: RoomState): string {
    const n = room.players.filter((p) => p.codename).length + 1;
    return `玩家${String(n).padStart(2, '0')}`;
  }

  private assignCodenames() {
    for (const room of Object.values(this.state.rooms)) {
      const shuffled = shuffle(room.players);
      shuffled.forEach((p, i) => {
        p.codename = `玩家${String(i + 1).padStart(2, '0')}`;
      });
      // 玩家列表按代号排序，避免顺序泄露加入时间
      room.players.sort((a, b) => a.codename.localeCompare(b.codename));
    }
    this.state.codenamesAssigned = true;
  }

  gotoPhase(phase: Phase) {
    if (this.state.phase === phase) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    if (!this.state.codenamesAssigned && phase !== 'LOBBY') {
      this.assignCodenames();
    }

    this.state.phase = phase;
    const duration = PHASE_DURATION[phase];
    this.state.phaseEndsAt = duration ? Date.now() + duration * 1000 : null;
    this.armTimer();

    const room = this.activeRoomState();
    if (phase === 'ROUND1_CHAT') {
      this.postSystem(room.id, `第一轮聊天开始！主问题：${room.mainQuestion} 每人至少发言一次，可以 @ 任何人追问。`);
    } else if (phase === 'ROUND1_VOTE') {
      this.postSystem(room.id, '第一轮投票开始：你认为谁是 AI？请附上你的理由。');
    } else if (phase === 'ROUND2_CHAT') {
      this.postSystem(
        room.id,
        '系统已经根据你们第一轮的判断，对部分玩家的行为模型做了调整。第二轮聊天开始！注意：本轮每人最多 @ 一人提问。',
      );
    } else if (phase === 'ROUND2_VOTE') {
      this.postSystem(room.id, '最终投票开始：这一轮的结果将决定胜负！');
    }

    this.emit('phase', phase);
    this.emit('change');
  }

  next() {
    const idx = PHASE_ORDER.indexOf(this.state.phase);
    if (idx < PHASE_ORDER.length - 1) this.gotoPhase(PHASE_ORDER[idx + 1]);
  }

  prev() {
    const idx = PHASE_ORDER.indexOf(this.state.phase);
    if (idx > 0) this.gotoPhase(PHASE_ORDER[idx - 1]);
  }

  extend(seconds: number) {
    const base = this.state.phaseEndsAt ?? Date.now();
    this.state.phaseEndsAt = Math.max(base, Date.now()) + seconds * 1000;
    this.armTimer();
    this.emit('change');
  }

  private armTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.state.phaseEndsAt) return;
    const ms = this.state.phaseEndsAt - Date.now();
    if (ms <= 0) return;
    this.timer = setTimeout(() => {
      if (AUTO_ADVANCE.has(this.state.phase)) this.next();
    }, ms);
  }

  // ---------- 聊天 ----------

  postSystem(roomId: RoomId, text: string) {
    const room = this.state.rooms[roomId];
    const msg: ChatMessage = {
      id: randomUUID(),
      roomId,
      playerId: '',
      codename: '主持人',
      text,
      round: roundOf(this.state.phase),
      mentions: [],
      system: true,
      ts: Date.now(),
    };
    room.messages.push(msg);
    this.emit('message', msg);
    this.emit('change');
  }

  parseMentions(room: RoomState, text: string): string[] {
    const ids: string[] = [];
    for (const p of room.players) {
      if (p.codename && text.includes(`@${p.codename}`)) ids.push(p.id);
    }
    return ids;
  }

  postMessage(playerId: string, rawText: string): ActionResult {
    const player = this.findPlayer(playerId);
    if (!player) return { ok: false, error: '玩家不存在' };
    if (!CHAT_PHASES.has(this.state.phase)) return { ok: false, error: '当前不是聊天阶段' };

    const text = rawText.trim().slice(0, MAX_MSG_LEN);
    if (!text) return { ok: false, error: '消息不能为空' };

    const round = roundOf(this.state.phase);
    const usage = this.usageOf(playerId);
    const count = round === 1 ? usage.msgs1 : usage.msgs2;
    if (count >= MAX_MSGS_PER_ROUND) {
      return { ok: false, error: `本轮发言已达上限（${MAX_MSGS_PER_ROUND} 条）` };
    }
    if (Date.now() - usage.lastMsgTs < MIN_MSG_INTERVAL_MS) {
      return { ok: false, error: '发言太快了，稍等一下' };
    }

    const room = this.state.rooms[player.roomId];
    const mentions = this.parseMentions(room, text).filter((id) => id !== playerId);

    if (round === 2 && mentions.length > 0) {
      if (usage.mentionUsed2) return { ok: false, error: '第二轮每人最多 @ 一人，你已用过' };
      if (mentions.length > 1) return { ok: false, error: '第二轮一条消息最多 @ 一个人' };
      usage.mentionUsed2 = true;
    }

    if (round === 1) usage.msgs1++;
    else usage.msgs2++;
    usage.lastMsgTs = Date.now();

    const msg: ChatMessage = {
      id: randomUUID(),
      roomId: player.roomId,
      playerId,
      codename: player.codename,
      text,
      round,
      mentions,
      system: false,
      ts: Date.now(),
    };
    room.messages.push(msg);
    this.emit('message', msg);
    this.emit('change');
    return { ok: true };
  }

  // ---------- 投票 ----------

  castVote(playerId: string, targetId: string, rawReason: string): ActionResult {
    const player = this.findPlayer(playerId);
    if (!player) return { ok: false, error: '玩家不存在' };
    if (!VOTE_PHASES.has(this.state.phase)) return { ok: false, error: '当前不是投票阶段' };
    if (targetId === playerId) return { ok: false, error: '不能投自己' };

    const room = this.state.rooms[player.roomId];
    const target = room.players.find((p) => p.id === targetId);
    if (!target) return { ok: false, error: '投票对象不在本房间' };

    const reason = rawReason.trim().slice(0, 100);
    if (reason.length < 2) return { ok: false, error: '请写一句理由' };

    const round = roundOf(this.state.phase);
    const votes = round === 1 ? room.votes.r1 : room.votes.r2;
    const existing = votes.findIndex((v) => v.voterId === playerId);
    const vote: Vote = { voterId: playerId, targetId, reason, ts: Date.now() };
    if (existing >= 0) votes[existing] = vote;
    else votes.push(vote);

    this.emit('change');
    return { ok: true };
  }

  myVote(playerId: string, round: 1 | 2): Vote | undefined {
    const p = this.findPlayer(playerId);
    if (!p) return undefined;
    const votes = round === 1 ? this.room(p.roomId).votes.r1 : this.room(p.roomId).votes.r2;
    return votes.find((v) => v.voterId === playerId);
  }

  setMainQuestion(roomId: RoomId, question: string) {
    const q = question.trim();
    if (!q) return;
    this.state.rooms[roomId].mainQuestion = q;
    this.emit('change');
  }

  // ---------- 揭晓 ----------

  reveal(playerId: string) {
    const p = this.findPlayer(playerId);
    if (p && !p.revealed) {
      p.revealed = true;
      this.emit('change');
    }
  }

  revealAll() {
    for (const room of Object.values(this.state.rooms)) {
      for (const p of room.players) p.revealed = true;
    }
    this.emit('change');
  }

  // ---------- 视图序列化 ----------

  /** 玩家可见的房间状态（不含身份/真名/票细节） */
  publicRoomState(roomId: RoomId) {
    const room = this.state.rooms[roomId];
    const round = roundOf(this.state.phase);
    const votes = round === 1 ? room.votes.r1 : room.votes.r2;
    return {
      now: Date.now(),
      phase: this.state.phase,
      phaseEndsAt: this.state.phaseEndsAt,
      room: {
        id: room.id,
        title: room.title,
        mainQuestion: room.mainQuestion,
        players: room.players.map((p) => ({
          id: p.id,
          codename: p.codename,
          connected: p.connected,
          // 身份仅在被主持人揭晓后公开
          isAI: p.revealed ? p.isAI : null,
          realName: p.revealed ? p.realName : null,
          revealed: p.revealed,
        })),
        playerCount: room.players.length,
        messages: room.messages.slice(-200),
        votedCount: votes.length,
      },
      limits: {
        maxMsgsPerRound: MAX_MSGS_PER_ROUND,
      },
      usage: Object.fromEntries(
        room.players.map((p) => {
          const u = this.usageOf(p.id);
          return [p.id, { msgs: round === 1 ? u.msgs1 : u.msgs2, mentionUsed2: u.mentionUsed2 }];
        }),
      ),
    };
  }

  /** 主持人视图：全量状态 + 奖项 */
  hostState() {
    return {
      now: Date.now(),
      phase: this.state.phase,
      phaseEndsAt: this.state.phaseEndsAt,
      codenamesAssigned: this.state.codenamesAssigned,
      activeRoom: this.state.activeRoom,
      rooms: Object.values(this.state.rooms).map((room) => ({
        id: room.id,
        title: room.title,
        mainQuestion: room.mainQuestion,
        players: room.players.map((p) => ({
          id: p.id,
          codename: p.codename,
          realName: p.realName,
          isAI: p.isAI,
          persona: p.persona ?? null,
          connected: p.connected,
          revealed: p.revealed,
          votesR1: room.votes.r1.filter((v) => v.targetId === p.id).length,
          votesR2: room.votes.r2.filter((v) => v.targetId === p.id).length,
        })),
        messages: room.messages.slice(-300),
        votes: room.votes,
      })),
      awards: this.awards(),
    };
  }

  /** 奖项：最强侦探 / 最强演员 / 最强 AI */
  awards() {
    const detectives: { codename: string; realName: string; roomId: RoomId; score: number }[] = [];
    const actors: { codename: string; realName: string; roomId: RoomId; votes: number }[] = [];
    const ais: { codename: string; realName: string; roomId: RoomId; votes: number }[] = [];

    // 只统计本局启用的房间，避免空房间的 0 票 AI 混进榜单
    const room = this.activeRoomState();
    const allVotes = [...room.votes.r1, ...room.votes.r2];
    for (const p of room.players) {
      const received = allVotes.filter((v) => v.targetId === p.id).length;
      if (p.isAI) {
        ais.push({ codename: p.codename, realName: p.realName, roomId: room.id, votes: received });
      } else {
        const correct = allVotes.filter((v) => {
          if (v.voterId !== p.id) return false;
          const target = room.players.find((x) => x.id === v.targetId);
          return target?.isAI ?? false;
        }).length;
        detectives.push({ codename: p.codename, realName: p.realName, roomId: room.id, score: correct });
        actors.push({ codename: p.codename, realName: p.realName, roomId: room.id, votes: received });
      }
    }

    detectives.sort((a, b) => b.score - a.score);
    actors.sort((a, b) => b.votes - a.votes);
    ais.sort((a, b) => a.votes - b.votes);
    return {
      detectives: detectives.slice(0, 3),
      actors: actors.slice(0, 3),
      ais: ais.slice(0, 3),
    };
  }
}
