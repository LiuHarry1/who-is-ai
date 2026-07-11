import type { ChatMessage, Phase, Player } from '../types.js';
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

  // ---------- 阶段驱动 ----------

  onPhase(phase: Phase) {
    this.clearScheduled();
    switch (phase) {
      case 'RULES':
        // 规则讲解阶段预生成主问题答案，规避开局 LLM 延迟
        void this.pregenerate();
        break;
      case 'ROUND1_CHAT':
        this.later(rand(15000, 60000), () => void this.postMainAnswer());
        break;
      case 'ROUND1_VOTE':
      case 'ROUND2_VOTE':
        this.later(rand(20000, 90000), () => this.castVote());
        break;
      case 'ROUND2_CHAT':
        this.computeSuspicion();
        // 低怀疑 AI 更主动：无人搭理也主动发言
        if (this.suspicion === 'low' || this.suspicion === 'none') {
          this.later(rand(20000, 50000), () => void this.reply(null));
        }
        break;
    }
  }

  private async pregenerate() {
    const room = this.engine.room(this.player.roomId);
    try {
      const raw = await chatComplete(
        buildMainAnswerPrompt(room, this.player.codename, this.player.persona!),
      );
      this.pregenAnswer = sanitizeOutput(raw, true);
      console.log(`[ai] ${this.player.realName} 预生成完成: ${this.pregenAnswer}`);
    } catch (err) {
      console.warn(`[ai] ${this.player.realName} 预生成失败:`, (err as Error).message);
    }
  }

  private async postMainAnswer() {
    if (!this.pregenAnswer) {
      const room = this.engine.room(this.player.roomId);
      try {
        const raw = await chatComplete(
          buildMainAnswerPrompt(room, this.player.codename, this.player.persona!),
        );
        this.pregenAnswer = sanitizeOutput(raw, true);
      } catch {
        this.pregenAnswer = fallback.generic();
      }
    }
    this.post(this.pregenAnswer);
  }

  /** 第一轮票数 -> 第二轮行为策略（需求第六节核心机制） */
  private computeSuspicion() {
    const room = this.engine.room(this.player.roomId);
    const total = room.votes.r1.length;
    if (total === 0) {
      this.suspicion = 'none';
      return;
    }
    const mine = room.votes.r1.filter((v) => v.targetId === this.player.id).length;
    const avg = total / Math.max(room.players.length, 1);
    if (mine >= Math.max(2, avg * 1.5)) this.suspicion = 'high';
    else if (mine <= avg * 0.5) this.suspicion = 'low';
    else this.suspicion = 'mid';
    console.log(`[ai] ${this.player.realName} 第一轮得票 ${mine}/${total}，第二轮策略: ${this.suspicion}`);
  }

  // ---------- 消息驱动 ----------

  onMessage(msg: ChatMessage) {
    if (msg.playerId === this.player.id) return;
    const phase = this.engine.state.phase;
    if (phase !== 'ROUND1_CHAT' && phase !== 'ROUND2_CHAT') return;

    const mentioned = msg.mentions.includes(this.player.id);
    if (mentioned) {
      // 被 @ 必回
      this.later(rand(1000, 4000), () => void this.reply(msg, true));
      return;
    }
    if (msg.system) return;
    if (this.busy) return;
    if (Date.now() - this.lastPostTs < 25000) return;
    if (this.remainingQuota() <= 1) return; // 留一条配额给可能的被 @ 回复

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
    if (this.busy) {
      if (!mustReply) return;
    }
    this.busy = true;
    try {
      const room = this.engine.room(this.player.roomId);
      const round = roundOf(this.engine.state.phase);
      const usage = this.engine.usageOf(this.player.id);
      const stripMentions = round === 2 && usage.mentionUsed2;

      let text: string;
      try {
        const raw = await chatComplete(
          buildReplyPrompt(room, this.player.codename, this.player.persona!, this.suspicion, trigger),
        );
        text = sanitizeOutput(raw, stripMentions);
      } catch (err) {
        console.warn(`[ai] ${this.player.realName} 生成失败:`, (err as Error).message);
        if (!mustReply) return; // 主动发言失败就放弃，不冷场卡死
        text = fallback.mentioned();
      }
      if (!text) return;

      this.post(text, typingDelayMs(text));
    } finally {
      this.busy = false;
    }
  }

  private post(text: string, delayMs = 0) {
    this.later(delayMs, () => {
      const res = this.engine.postMessage(this.player.id, text);
      if (res.ok) this.lastPostTs = Date.now();
      else console.log(`[ai] ${this.player.realName} 发言被拒: ${res.error}`);
    });
  }

  // ---------- 投票 ----------

  private castVote() {
    const room = this.engine.room(this.player.roomId);
    const candidates = room.players.filter((p) => p.id !== this.player.id);
    if (candidates.length === 0) return;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const res = this.engine.castVote(this.player.id, target.id, fallback.voteReason());
    if (!res.ok) console.log(`[ai] ${this.player.realName} 投票失败: ${res.error}`);
  }
}

/** 管理所有 AI 控制器，订阅引擎事件并分发 */
export class AIManager {
  private controllers = new Map<string, AIController>();

  constructor(private engine: GameEngine) {
    engine.on('aiAdded', (player: Player) => {
      this.controllers.set(player.id, new AIController(player, engine));
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

  /** 服务重启从快照恢复时，为已有 AI 玩家重建控制器 */
  restore() {
    for (const room of Object.values(this.engine.state.rooms)) {
      for (const p of room.players) {
        if (p.isAI && !this.controllers.has(p.id)) {
          this.controllers.set(p.id, new AIController(p, this.engine));
        }
      }
    }
  }

  clear() {
    for (const c of this.controllers.values()) c.dispose();
    this.controllers.clear();
  }
}
