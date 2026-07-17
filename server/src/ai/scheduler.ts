import type { ChatMessage, Phase, Player, RoomId } from '../types.js';
import { GameEngine, roundOf } from '../game/engine.js';
import { chatComplete } from '../llm.js';
import { buildMainAnswerPrompt, buildReplyPrompt, sanitizeOutput, type Suspicion } from './prompts.js';
import { fallback } from './fallback.js';

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 阅读延迟 + 按字数模拟打字延迟 */
function typingDelayMs(text: string): number {
  return rand(2000, 5000) + Math.min(text.length * rand(200, 350), 20000);
}

/**
 * 房间级错峰：同一时刻只允许一个 AI 生成；
 * 任一 AI 发言后，其他 AI 主动/接话需冷却，避免「一人说完另一个立刻跟」。
 */
class RoomSpeakGate {
  private busyId: string | null = null;
  private lastAiSpeakTs = 0;
  private cooldownUntil = 0;
  private waiters: Array<() => void> = [];

  /** 主动发言 / 接话所需的冷却（被 @ 可跳过） */
  cooldownReady(): boolean {
    return Date.now() >= this.cooldownUntil;
  }

  recentlySpoke(): boolean {
    return this.lastAiSpeakTs > 0 && Date.now() - this.lastAiSpeakTs < 20000;
  }

  noteAiSpoke() {
    this.lastAiSpeakTs = Date.now();
    this.cooldownUntil = Date.now() + rand(8000, 20000);
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

  onPhase(phase: Phase) {
    this.clearScheduled();
    switch (phase) {
      case 'RULES':
        void this.pregenerate();
        break;
      case 'ROUND1_CHAT':
        // 错峰：不同 AI 错开首答时间
        this.later(rand(15000, 70000), () => void this.postMainAnswer());
        break;
      case 'ROUND1_VOTE':
      case 'ROUND2_VOTE':
        this.later(rand(20000, 90000), () => this.castVote());
        break;
      case 'ROUND2_CHAT':
        this.computeSuspicion();
        if (this.suspicion === 'low' || this.suspicion === 'none') {
          this.later(rand(25000, 70000), () => void this.reply(null));
        }
        break;
    }
  }

  private async pregenerate() {
    const room = this.engine.room(this.player.roomId);
    try {
      const raw = await chatComplete(
        buildMainAnswerPrompt(room, this.player.codename, this.player.persona!),
        200,
        this.model(),
      );
      this.pregenAnswer = sanitizeOutput(raw, true);
      console.log(`[ai] ${this.player.realName}(${this.model()}) 预生成完成: ${this.pregenAnswer}`);
    } catch (err) {
      console.warn(`[ai] ${this.player.realName} 预生成失败:`, (err as Error).message);
    }
  }

  private async postMainAnswer() {
    await this.gate.acquire(this.player.id);
    try {
      if (this.gate.recentlySpoke()) {
        await new Promise((r) => setTimeout(r, rand(8000, 15000)));
      }
      if (!this.pregenAnswer) {
        const room = this.engine.room(this.player.roomId);
        try {
          const raw = await chatComplete(
            buildMainAnswerPrompt(room, this.player.codename, this.player.persona!),
            200,
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

    const mentioned = msg.mentions.includes(this.player.id);
    if (mentioned) {
      this.later(rand(1500, 5000), () => void this.reply(msg, true));
      return;
    }
    if (msg.system) return;

    // 不接其他 AI 的话，避免「AI 连环跟帖」
    const sender = this.engine.findPlayer(msg.playerId);
    if (sender?.isAI) return;

    if (this.busy) return;
    if (Date.now() - this.lastPostTs < 25000) return;
    if (!this.gate.cooldownReady()) return;
    if (this.remainingQuota() <= 1) return;

    const round = roundOf(phase);
    let p = 0.25;
    if (round === 2) {
      p = this.suspicion === 'high' ? 0.08 : this.suspicion === 'low' ? 0.35 : 0.2;
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

  private async reply(trigger: ChatMessage | null, mustReply = false) {
    if (this.busy && !mustReply) return;
    if (!mustReply && !this.gate.cooldownReady()) return;

    this.busy = true;
    await this.gate.acquire(this.player.id);
    try {
      if (!mustReply && !this.gate.cooldownReady()) return;

      const room = this.engine.room(this.player.roomId);
      const round = roundOf(this.engine.state.phase);
      const usage = this.engine.usageOf(this.player.id);
      const stripMentions = round === 2 && usage.mentionUsed2;

      let text: string;
      try {
        const raw = await chatComplete(
          buildReplyPrompt(room, this.player.codename, this.player.persona!, this.suspicion, trigger),
          200,
          this.model(),
        );
        text = sanitizeOutput(raw, stripMentions);
      } catch (err) {
        console.warn(`[ai] ${this.player.realName} 生成失败:`, (err as Error).message);
        if (!mustReply) return;
        text = fallback.mentioned();
      }
      if (!text) return;

      this.post(text, typingDelayMs(text));
    } finally {
      this.busy = false;
      this.gate.release(this.player.id);
    }
  }

  private post(text: string, delayMs = 0) {
    this.later(delayMs, () => {
      const res = this.engine.postMessage(this.player.id, text);
      if (res.ok) {
        this.lastPostTs = Date.now();
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
