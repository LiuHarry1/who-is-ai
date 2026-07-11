import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { config } from './config.js';
import { GameEngine } from './game/engine.js';
import { attachSnapshot, loadSnapshot } from './game/snapshot.js';
import { AIManager } from './ai/scheduler.js';
import { pickPersona } from './ai/personas.js';
import { getAiConfig, saveAiConfig, resetAiConfig } from './ai/aiConfig.js';
import { domainNotes, setDomainNotes } from './ai/domainNotes.js';
import { listModels, testConnection } from './llm.js';
import type { Persona, RoomId } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 引擎 & AI ----------

const engine = new GameEngine();
const aiManager = new AIManager(engine);

const snapshot = loadSnapshot();
if (snapshot) {
  engine.loadState(snapshot);
  aiManager.restore();
  console.log(`[boot] 从快照恢复，phase=${engine.state.phase}`);
} else {
  seedDefaultAIs();
  applyMainQuestions();
}
attachSnapshot(engine);

/** 把（可能被主持人编辑过的）主问题应用到房间 */
function applyMainQuestions() {
  const q = getAiConfig().mainQuestions;
  engine.setMainQuestion('tech', q.tech);
  engine.setMainQuestion('life', q.life);
}

/** 默认 AI 配置：技术房 1 个，生活房 2 个（其中一个是隐藏的第 2 个 AI） */
function seedDefaultAIs() {
  const usedNames: string[] = [];
  const seed = (roomId: RoomId, count: number) => {
    for (let i = 0; i < count; i++) {
      const persona = pickPersona(roomId, usedNames);
      usedNames.push(persona.name);
      engine.addAI(roomId, persona);
    }
  };
  seed('tech', 1);
  seed('life', 2);
  console.log('[boot] 默认 AI 已就位：技术房 1 个，生活房 2 个');
}

// ---------- HTTP & Socket.IO ----------

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

const publicDir = process.env.PUBLIC_DIR || path.resolve(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// 状态广播（debounce 合并高频变化）
let broadcastTimer: NodeJS.Timeout | null = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    io.to('room:tech').emit('state', engine.publicRoomState('tech'));
    io.to('room:life').emit('state', engine.publicRoomState('life'));
    io.to('hosts').emit('host:state', engine.hostState());
  }, 100);
}
engine.on('change', scheduleBroadcast);

io.on('connection', (socket) => {
  // ---------- 玩家 ----------

  socket.on('join', (payload: { roomId?: RoomId; name?: string; token?: string }, cb) => {
    try {
      // 重连：token 优先
      if (payload.token) {
        const player = engine.findByToken(payload.token);
        if (player) {
          socket.data.playerId = player.id;
          socket.join(`room:${player.roomId}`);
          engine.setConnected(player.id, true);
          cb?.({
            ok: true,
            playerId: player.id,
            token: player.token,
            roomId: player.roomId,
            state: engine.publicRoomState(player.roomId),
            myVotes: { r1: engine.myVote(player.id, 1) ?? null, r2: engine.myVote(player.id, 2) ?? null },
          });
          return;
        }
      }
      if (!payload.roomId || !(payload.roomId in engine.state.rooms)) {
        cb?.({ ok: false, error: '房间不存在' });
        return;
      }
      const res = engine.join(payload.roomId, payload.name ?? '');
      if (!res.ok || !res.player) {
        cb?.({ ok: false, error: res.error });
        return;
      }
      socket.data.playerId = res.player.id;
      socket.join(`room:${res.player.roomId}`);
      cb?.({
        ok: true,
        playerId: res.player.id,
        token: res.player.token,
        roomId: res.player.roomId,
        state: engine.publicRoomState(res.player.roomId),
        myVotes: { r1: null, r2: null },
      });
    } catch (err) {
      console.error('[join] error:', err);
      cb?.({ ok: false, error: '服务器内部错误' });
    }
  });

  socket.on('chat:send', (payload: { text?: string }, cb) => {
    const playerId = socket.data.playerId as string | undefined;
    if (!playerId) return cb?.({ ok: false, error: '未加入房间' });
    cb?.(engine.postMessage(playerId, payload.text ?? ''));
  });

  socket.on('vote:cast', (payload: { targetId?: string; reason?: string }, cb) => {
    const playerId = socket.data.playerId as string | undefined;
    if (!playerId) return cb?.({ ok: false, error: '未加入房间' });
    cb?.(engine.castVote(playerId, payload.targetId ?? '', payload.reason ?? ''));
  });

  // ---------- 主持人 ----------

  socket.on('host:auth', (payload: { key?: string }, cb) => {
    if (payload.key !== config.hostKey) {
      cb?.({ ok: false, error: '口令错误' });
      return;
    }
    socket.data.isHost = true;
    socket.join('hosts');
    cb?.({ ok: true, state: engine.hostState() });
  });

  socket.on('host:action', (payload: { type?: string; [k: string]: unknown }, cb) => {
    if (!socket.data.isHost) return cb?.({ ok: false, error: '无权限' });
    try {
      switch (payload.type) {
        case 'next':
          engine.next();
          break;
        case 'prev':
          engine.prev();
          break;
        case 'goto':
          engine.gotoPhase(payload.phase as never);
          break;
        case 'extend':
          engine.extend(Number(payload.seconds) || 60);
          break;
        case 'addAI': {
          const roomId = payload.roomId as RoomId;
          if (!(roomId in engine.state.rooms)) return cb?.({ ok: false, error: '房间不存在' });
          const room = engine.room(roomId);
          const used = room.players.filter((p) => p.persona).map((p) => p.persona!.name);
          engine.addAI(roomId, pickPersona(roomId, used));
          break;
        }
        case 'removeAI': {
          const roomId = payload.roomId as RoomId;
          if (!(roomId in engine.state.rooms)) return cb?.({ ok: false, error: '房间不存在' });
          if (!engine.removeAI(roomId)) return cb?.({ ok: false, error: '该房间没有 AI' });
          break;
        }
        case 'reveal':
          engine.reveal(String(payload.playerId ?? ''));
          break;
        case 'revealAll':
          engine.revealAll();
          break;
        case 'announce': {
          const roomId = payload.roomId as RoomId | 'all';
          const text = String(payload.text ?? '').trim();
          if (!text) return cb?.({ ok: false, error: '内容为空' });
          const targets: RoomId[] = roomId === 'all' ? ['tech', 'life'] : [roomId];
          for (const r of targets) if (r in engine.state.rooms) engine.postSystem(r, text);
          break;
        }
        case 'reset':
          aiManager.clear();
          engine.reset();
          seedDefaultAIs();
          applyMainQuestions();
          break;
        default:
          return cb?.({ ok: false, error: `未知操作: ${payload.type}` });
      }
      cb?.({ ok: true });
    } catch (err) {
      console.error('[host:action] error:', err);
      cb?.({ ok: false, error: '操作失败' });
    }
  });

  // ---------- 管理：在线编辑 AI 配置 ----------

  socket.on('admin:get', async (_payload, cb) => {
    if (!socket.data.isHost) return cb?.({ ok: false, error: '无权限' });
    cb?.({
      ok: true,
      data: {
        config: getAiConfig(),
        domainNotes: { tech: domainNotes('tech'), life: domainNotes('life') },
        modelList: await listModels(),
      },
    });
  });

  socket.on('admin:save', async (payload: { section?: string; data?: unknown }, cb) => {
    if (!socket.data.isHost) return cb?.({ ok: false, error: '无权限' });
    try {
      const cfg = structuredClone(getAiConfig());
      switch (payload.section) {
        case 'domainNotes': {
          const d = payload.data as { tech?: string; life?: string };
          if (typeof d?.tech === 'string') setDomainNotes('tech', d.tech);
          if (typeof d?.life === 'string') setDomainNotes('life', d.life);
          break;
        }
        case 'mainQuestions': {
          const d = payload.data as { tech?: string; life?: string };
          if (d?.tech?.trim()) cfg.mainQuestions.tech = d.tech.trim();
          if (d?.life?.trim()) cfg.mainQuestions.life = d.life.trim();
          saveAiConfig(cfg);
          applyMainQuestions();
          break;
        }
        case 'personas': {
          const d = payload.data as { tech?: Persona[]; life?: Persona[] };
          for (const roomId of ['tech', 'life'] as const) {
            const list = d?.[roomId];
            if (!Array.isArray(list)) continue;
            const cleaned = list
              .map((p) => ({
                name: String(p?.name ?? '').trim().slice(0, 20),
                background: String(p?.background ?? '').trim().slice(0, 500),
                style: String(p?.style ?? '').trim().slice(0, 300),
              }))
              .filter((p) => p.name && p.background);
            if (cleaned.length === 0) return cb?.({ ok: false, error: `${roomId} 房间至少要有一张有效人格卡` });
            cfg.personas[roomId] = cleaned;
          }
          saveAiConfig(cfg);
          break;
        }
        case 'prompts': {
          const d = payload.data as Partial<Record<string, string>>;
          const keys = [
            'baseRules',
            'roomContextTech',
            'roomContextLife',
            'strategyHigh',
            'strategyLow',
            'strategyMid',
            'strategyNone',
          ] as const;
          for (const k of keys) {
            if (typeof d?.[k] === 'string') cfg.prompts[k] = (d[k] as string).slice(0, 5000);
          }
          saveAiConfig(cfg);
          break;
        }
        case 'models': {
          const d = payload.data as { baseUrl?: string; apiKey?: string; primary?: string; fallback?: string };
          if (d?.baseUrl?.trim()) cfg.models.baseUrl = d.baseUrl.trim();
          if (d?.apiKey?.trim()) cfg.models.apiKey = d.apiKey.trim();
          if (d?.primary?.trim()) cfg.models.primary = d.primary.trim();
          if (d?.fallback?.trim()) cfg.models.fallback = d.fallback.trim();
          saveAiConfig(cfg);
          console.log(
            `[admin] LLM 配置已更新: ${cfg.models.baseUrl} (${cfg.models.primary} -> ${cfg.models.fallback})`,
          );
          break;
        }
        case 'resetDefaults':
          resetAiConfig();
          applyMainQuestions();
          break;
        default:
          return cb?.({ ok: false, error: `未知配置项: ${payload.section}` });
      }
      cb?.({
        ok: true,
        data: {
          config: getAiConfig(),
          domainNotes: { tech: domainNotes('tech'), life: domainNotes('life') },
          modelList: await listModels(),
        },
      });
    } catch (err) {
      console.error('[admin:save] error:', err);
      cb?.({ ok: false, error: '保存失败' });
    }
  });

  socket.on('admin:testLLM', async (_payload, cb) => {
    if (!socket.data.isHost) return cb?.({ ok: false, error: '无权限' });
    cb?.(await testConnection());
  });

  socket.on('disconnect', () => {
    const playerId = socket.data.playerId as string | undefined;
    if (playerId) engine.setConnected(playerId, false);
  });
});

server.listen(config.port, () => {
  console.log(`[boot] Who is AI server listening on :${config.port}`);
  console.log(`[boot] LLM: ${config.openaiBaseUrl} (${config.modelPrimary} -> ${config.modelFallback})`);
});
