import type { ChatMessage, Phase, Player, RoomId } from '../types.js';
import { GameEngine, roundOf } from '../game/engine.js';
import { chatComplete } from '../llm.js';
import { buildMainAnswerPrompt, buildReplyPrompt, sanitizeOutput, type Suspicion } from './prompts.js';
import { fallback } from './fallback.js';

const HUMAN_MSG_GATE = 2;
const COLD_START_MS = 90_000;
/** 被 @ 时回复概率（也可不理，以免露馅） */
const MENTION_REPLY_P = 0.5;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 阅读延迟 + 按字数模拟打字延迟 */
function typingDelayMs(text: string): number {
  return rand(2000, 5000) + Math.min(text.length * rand(200, 350), 20000);
}

/**
 * 房间级错峰：同一时刻只允许一个 AI 生成；
 * 任一 AI 发言后，必须再有至少 1 条人类消息，其他 AI 才能开口（禁止 AI 连麦）。
 */
class RoomSpeakGate {
  private busyId: string | null = null;
  private lastAiSpeakTs = 0;
  private cooldownUntil = 0;
  /** 上一条非系统发言若是 AI，则需等人类插话后才能再有 AI 发言 */
  private needHumanBeforeNextAi = false;
  private waiters: Array<() => void> = [];

  cooldownReady(): boolean {
    return Date.now() >= this.cooldownUntil;
  }

  /** AI 之间至少隔一名人类 */
  humanGapReady(): boolean {
    return !this.needHumanBeforeNextAi;
  }

  recentlySpoke(): boolean {
    return this.lastAiSpeakTs > 0 && Date.now() - this.lastAiSpeakTs < 20000;
  }

  noteAiSpoke() {
    this.lastAiSpeakTs = Date.now();
    this.cooldownUntil = Date.now() + rand(8000, 20000);
    this.needHumanBeforeNextAi = true;
  }

  noteHumanSpoke() {
    this.needHumanBeforeNextAi = false;
  }

  resetChatRound() {
    this.needHumanBeforeNextAi = false;
    this.lastAiSpeakTs = 0;
    this.cooldownUntil = 0;
  }

  async acquire(playerId: string): Promise<boolean> {
    if (this.busyId === playerId) return true;
    while (this.busyId) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.busyId = playerId;
    return true;
  }

  release(playerId: string) {
    if (this.busyId !== playerId) return;
    this.busyId = null;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/** 单个 AI 玩家的行为控制器 */
class AIController {
  private pregenAnswer: string | null = null;
  private suspicion: Suspicion = 'none';
  private busy = false;
  private lastPostTs = 0;
  private timers: NodeJS.Timeout[] = [];
  /** 本轮聊天阶段开始时间（用于 90s 冷场超时） */
  private chatPhaseStartedAt = 0;
  /** 本轮是否已开过口（首次发言需过人类消息门槛） */
  private hasSpokenThisChat = false;

  constructor(
    public readonly player: Player,
    private engine: GameEngine,
    private gate: RoomSpeakGate,
  ) {}

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  private clearScheduled() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private model(): string {
    return this.player.model || 'claude-opus-4.6';
  }

  /** 本轮非系统、非 AI 的人类消息数 */
  private humanMsgCount(): number {
    const room = this.engine.room(this.player.roomId);
    const round = roundOf(this.engine.state.phase);
    if (!round) return 0;
    return room.messages.filter((m) => {
      if (m.system || m.round !== round) return false;
      const sender = this.engine.findPlayer(m.playerId);
      return Boolean(sender && !sender.isAI);
    }).length;
  }

  /** 是否允许开口：≥2 条人类消息，或开局已满 90s */
  private maySpeak(): boolean {
    if (this.hasSpokenThisChat) return true;
    if (this.humanMsgCount() >= HUMAN_MSG_GATE) return true;
    if (this.chatPhaseStartedAt > 0 && Date.now() - this.chatPhaseStartedAt >= COLD_START_MS) {
      return true;
    }
    return false;
  }

  onPhase(phase: Phase) {
    this.clearScheduled();
    switch (phase) {
      case 'RULES':
        void this.pregenerate();
        break;
      case 'ROUND1_CHAT':
        this.hasSpokenThisChat = false;
        this.chatPhaseStartedAt = Date.now();
        this.gate.resetChatRound();
        // 冷场超时后再考虑主动开口；平时等人类先聊、靠 onMessage 触发
        this.later(COLD_START_MS + rand(2000, 15000), () => void this.maybeColdStart());
        break;
      case 'ROUND1_VOTE':
      case 'ROUND2_VOTE':
        this.later(rand(20000, 90000), () => this.castVote());
        break;
      case 'ROUND2_CHAT':
        this.hasSpokenThisChat = false;
        this.chatPhaseStartedAt = Date.now();
        this.gate.resetChatRound();
        this.computeSuspicion();
        if (this.suspicion === 'low' || this.suspicion === 'none') {
          this.later(COLD_START_MS + rand(5000, 20000), () => void this.maybeColdStart());
        }
        break;
    }
  }

  /** 冷场超时后的主动开口：有人类消息则接话，否则可发短主答 */
  private async maybeColdStart() {
    const phase = this.engine.state.phase;
    if (phase !== 'ROUND1_CHAT' && phase !== 'ROUND2_CHAT') return;
    if (this.hasSpokenThisChat || this.busy) return;
    if (!this.maySpeak()) return;
    if (!this.gate.humanGapReady()) return;

    const room = this.engine.room(this.player.roomId);
    const round = roundOf(phase);
    const lastHuman = [...room.messages]
      .reverse()
      .find((m) => {
        if (m.system || (round && m.round !== round)) return false;
        const s = this.engine.findPlayer(m.playerId);
        return Boolean(s && !s.isAI);
      });

    if (lastHuman) {
      await this.reply(lastHuman, false);
      return;
    }
    // 仍无人说话：第一轮可发预生成短主答；第二轮接空触发短句
    if (phase === 'ROUND1_CHAT') {
      await this.postMainAnswer();
    } else {
      await this.reply(null, false);
    }
  }

  private async pregenerate() {
    const room = this.engine.room(this.player.roomId);
    try {
      const raw = await chatComplete(
        buildMainAnswerPrompt(room, this.player.codename, this.player.persona!),
        80,
        this.model(),
      );
      this.pregenAnswer = sanitizeOutput(raw, true);
      console.log(`[ai] ${this.player.realName}(${this.model()}) 预生成完成: ${this.pregenAnswer}`);
    } catch (err) {
      console.warn(`[ai] ${this.player.realName} 预生成失败:`, (err as Error).message);
    }
  }

  private async postMainAnswer() {
    if (!this.maySpeak()) return;
    if (!this.gate.humanGapReady()) return;
    await this.gate.acquire(this.player.id);
    try {
      if (!this.gate.humanGapReady()) return;
      if (this.gate.recentlySpoke()) {
        await new Promise((r) => setTimeout(r, rand(8000, 15000)));
      }
      if (!this.gate.humanGapReady()) return;
      if (!this.pregenAnswer) {
        const room = this.engine.room(this.player.roomId);
        try {
          const raw = await chatComplete(
            buildMainAnswerPrompt(room, this.player.codename, this.player.persona!),
            80,
            this.model(),
          );
          this.pregenAnswer = sanitizeOutput(raw, true);
        } catch {
          this.pregenAnswer = fallback.generic();
        }
      }
      this.post(this.pregenAnswer);
    } finally {
      this.gate.release(this.player.id);
    }
  }

  private computeSuspicion() {
    const room = this.engine.room(this.player.roomId);
    const total = room.votes.r1.length;
    if (total === 0) {
      this.suspicion = 'none';
      return;
    }
    const mine = this.engine.votesFor(this.player.id, 1);
    const avg = total / Math.max(room.players.length, 1);
    if (mine >= Math.max(2, avg * 1.5)) this.suspicion = 'high';
    else if (mine <= avg * 0.5) this.suspicion = 'low';
    else this.suspicion = 'mid';
    console.log(`[ai] ${this.player.realName} 第一轮得票 ${mine}/${total}，第二轮策略: ${this.suspicion}`);
  }

  onMessage(msg: ChatMessage) {
    if (msg.playerId === this.player.id) return;
    const phase = this.engine.state.phase;
    if (phase !== 'ROUND1_CHAT' && phase !== 'ROUND2_CHAT') return;

    if (!msg.system) {
      const sender = this.engine.findPlayer(msg.playerId);
      if (sender && !sender.isAI) this.gate.noteHumanSpoke();
    }

    const mentioned = msg.mentions.includes(this.player.id);
    if (mentioned) {
      // 被 @ 也可不理；回则以别露馅为准
      if (Math.random() >= MENTION_REPLY_P) return;
      this.later(rand(2500, 8000), () => {
        if (!this.maySpeak() || !this.gate.humanGapReady()) return;
        void this.reply(msg, false);
      });
      return;
    }
    if (msg.system) return;

    // 不接其他 AI 的话，避免「AI 连环跟帖」
    const sender = this.engine.findPlayer(msg.playerId);
    if (sender?.isAI) return;

    if (!this.maySpeak()) return;
    if (!this.gate.humanGapReady()) return;
    if (this.busy) return;
    if (Date.now() - this.lastPostTs < 25000) return;
    if (!this.gate.cooldownReady()) return;
    if (this.remainingQuota() <= 1) return;

    const round = roundOf(phase);
    let p = 0.2;
    if (round === 2) {
      p = this.suspicion === 'high' ? 0.06 : this.suspicion === 'low' ? 0.28 : 0.15;
    }
    if (Math.random() < p) {
      void this.reply(msg, false);
    }
  }

  private remainingQuota(): number {
    const usage = this.engine.usageOf(this.player.id);
    const round = roundOf(this.engine.state.phase);
    return 5 - (round === 1 ? usage.msgs1 : usage.msgs2);
  }

  private async reply(trigger: ChatMessage | null, _force = false) {
    if (!this.maySpeak()) return;
    if (!this.gate.humanGapReady()) return;
    if (this.busy) return;
    if (!this.gate.cooldownReady()) return;

    this.busy = true;
    await this.gate.acquire(this.player.id);
    try {
      if (!this.gate.humanGapReady()) return;
      if (!this.gate.cooldownReady()) return;

      const room = this.engine.room(this.player.roomId);
      const round = roundOf(this.engine.state.phase);
      const usage = this.engine.usageOf(this.player.id);
      const stripMentions = round === 2 && usage.mentionUsed2;

      let text: string;
      try {
        const raw = await chatComplete(
          buildReplyPrompt(room, this.player.codename, this.player.persona!, this.suspicion, trigger),
          80,
          this.model(),
        );
        text = sanitizeOutput(raw, stripMentions);
      } catch (err) {
        console.warn(`[ai] ${this.player.realName} 生成失败:`, (err as Error).message);
        return;
      }
      if (!text) return;
      // 生成期间若另一 AI 已发言，仍需等人类插话
      if (!this.gate.humanGapReady()) return;

      this.post(text, typingDelayMs(text));
    } finally {
      this.busy = false;
      this.gate.release(this.player.id);
    }
  }

  private post(text: string, delayMs = 0) {
    this.later(delayMs, () => {
      if (!this.gate.humanGapReady()) {
        console.log(`[ai] ${this.player.realName} 取消发言：需等人类插话后再发`);
        return;
      }
      const res = this.engine.postMessage(this.player.id, text);
      if (res.ok) {
        this.lastPostTs = Date.now();
        this.hasSpokenThisChat = true;
        this.gate.noteAiSpoke();
      } else console.log(`[ai] ${this.player.realName} 发言被拒: ${res.error}`);
    });
  }

  private castVote() {
    const room = this.engine.room(this.player.roomId);
    const candidates = room.players.filter((p) => p.id !== this.player.id);
    if (candidates.length === 0) return;

    const round = roundOf(this.engine.state.phase);
    const pickCount = round === 2 && candidates.length >= 2 && Math.random() < 0.4 ? 2 : 1;
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const targets = shuffled.slice(0, pickCount).map((p) => p.id);
    const res = this.engine.castVote(this.player.id, targets, fallback.voteReason());
    if (!res.ok) console.log(`[ai] ${this.player.realName} 投票失败: ${res.error}`);
  }
}

/** 管理所有 AI 控制器，订阅引擎事件并分发 */
export class AIManager {
  private controllers = new Map<string, AIController>();
  private gates = new Map<RoomId, RoomSpeakGate>();

  constructor(private engine: GameEngine) {
    engine.on('aiAdded', (player: Player) => {
      this.controllers.set(player.id, new AIController(player, engine, this.gateFor(player.roomId)));
    });
    engine.on('aiRemoved', (player: Player) => {
      this.controllers.get(player.id)?.dispose();
      this.controllers.delete(player.id);
    });
    engine.on('phase', (phase: Phase) => {
      for (const c of this.controllers.values()) c.onPhase(phase);
    });
    engine.on('message', (msg: ChatMessage) => {
      for (const c of this.controllers.values()) {
        if (c.player.roomId === msg.roomId) c.onMessage(msg);
      }
    });
  }

  private gateFor(roomId: RoomId): RoomSpeakGate {
    let g = this.gates.get(roomId);
    if (!g) {
      g = new RoomSpeakGate();
      this.gates.set(roomId, g);
    }
    return g;
  }

  restore() {
    for (const room of Object.values(this.engine.state.rooms)) {
      for (const p of room.players) {
        if (p.isAI && !this.controllers.has(p.id)) {
          this.controllers.set(p.id, new AIController(p, this.engine, this.gateFor(p.roomId)));
        }
      }
    }
  }

  clear() {
    for (const c of this.controllers.values()) c.dispose();
    this.controllers.clear();
    this.gates.clear();
  }
}
