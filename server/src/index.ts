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
import { generateRecap } from './ai/recap.js';
import { listModels, testConnection } from './llm.js';
import type { Persona, Phase, RoomId } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/** 揭晓阶段异步生成 LLM 复盘 */
engine.on('phase', (phase: Phase) => {
  if (phase !== 'REVEAL') return;
  const room = engine.activeRoomState();
  const outcome = engine.state.outcome;
  void (async () => {
    try {
      const recap = await generateRecap(room, outcome);
      if (engine.state.phase === 'REVEAL') engine.setRecap(recap);
    } catch (err) {
      console.warn('[recap] 生成失败:', (err as Error).message);
    }
  })();
});

function applyMainQuestions() {
  const q = getAiConfig().mainQuestions;
  engine.setMainQuestion('food', q.food);
  engine.setMainQuestion('travel', q.travel);
}

/** 默认 AI：本局房间布置 2 个（第1个 Claude，第2个 GPT） */
function seedDefaultAIs() {
  const roomId = engine.state.activeRoom;
  const usedNames: string[] = [];
  for (let i = 0; i < 2; i++) {
    const persona = pickPersona(roomId, usedNames);
    usedNames.push(persona.name);
    engine.addAI(roomId, persona);
  }
  console.log(`[boot] 默认 AI 已就位：${roomId} 房 2 个`);
}

function clearAllAIs() {
  for (const roomId of ['food', 'travel'] as const) {
    while (engine.removeAI(roomId)) {
      /* clear */
    }
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

function clientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0]!.trim();
  if (Array.isArray(xff) && xff[0]) return xff[0].split(',')[0]!.trim();
  return req.socket.remoteAddress || '-';
}

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    console.log(
      `[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms` +
        ` ip=${clientIp(req)}` +
        ` host=${req.headers.host || '-'}`,
    );
  });
  next();
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'whoisai',
    phase: engine.state.phase,
    uptimeSec: Math.floor(process.uptime()),
    time: new Date().toISOString(),
  });
});

const publicDir = process.env.PUBLIC_DIR || path.resolve(__dirname, '../public');
const hasPublic = fs.existsSync(publicDir);
if (hasPublic) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  console.warn(`[boot] public 目录不存在: ${publicDir}（仅 API/Socket，无前端静态页）`);
}

let broadcastTimer: NodeJS.Timeout | null = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    io.to('room:food').emit('state', engine.publicRoomState('food'));
    io.to('room:travel').emit('state', engine.publicRoomState('travel'));
    io.to('hosts').emit('host:state', engine.hostState());
  }, 100);
}
engine.on('change', scheduleBroadcast);

io.on('connection', (socket) => {
  const hdr = socket.handshake.headers;
  const ip =
    (typeof hdr['x-forwarded-for'] === 'string' && hdr['x-forwarded-for'].split(',')[0]?.trim()) ||
    socket.handshake.address;
  console.log(`[socket] connect id=${socket.id} ip=${ip}`);

  socket.on('meta:get', (_payload, cb) => {
    const room = engine.activeRoomState();
    cb?.({
      ok: true,
      activeRoom: engine.state.activeRoom,
      title: room.title,
      phase: engine.state.phase,
      maxHumans: engine.state.maxHumans,
    });
  });

  socket.on('join', (payload: { roomId?: RoomId; name?: string; userId?: string; token?: string }, cb) => {
    try {
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
      const res = engine.join(payload.roomId, payload.name ?? '', payload.userId ?? '');
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

  socket.on(
    'vote:cast',
    (payload: { targetId?: string; targetIds?: string[]; reason?: string }, cb) => {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) return cb?.({ ok: false, error: '未加入房间' });
      const ids =
        Array.isArray(payload.targetIds) && payload.targetIds.length > 0
          ? payload.targetIds
          : payload.targetId
            ? [payload.targetId]
            : [];
      cb?.(engine.castVote(playerId, ids, payload.reason ?? ''));
    },
  );

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
        case 'setActiveRoom': {
          const roomId = payload.roomId as RoomId;
          if (!(roomId in engine.state.rooms)) return cb?.({ ok: false, error: '房间不存在' });
          const res = engine.setActiveRoom(roomId);
          if (!res.ok) return cb?.(res);
          clearAllAIs();
          seedDefaultAIs();
          break;
        }
        case 'setMaxHumans': {
          const res = engine.setMaxHumans(Number(payload.maxHumans));
          if (!res.ok) return cb?.(res);
          break;
        }
        case 'setAIModel': {
          const res = engine.setAIModel(String(payload.playerId ?? ''), String(payload.model ?? ''));
          if (!res.ok) return cb?.(res);
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
          const targets: RoomId[] = roomId === 'all' ? [engine.state.activeRoom] : [roomId];
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

  socket.on('admin:get', async (_payload, cb) => {
    if (!socket.data.isHost) return cb?.({ ok: false, error: '无权限' });
    cb?.({
      ok: true,
      data: {
        config: getAiConfig(),
        domainNotes: { food: domainNotes('food'), travel: domainNotes('travel') },
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
          const d = payload.data as { food?: string; travel?: string };
          if (typeof d?.food === 'string') setDomainNotes('food', d.food);
          if (typeof d?.travel === 'string') setDomainNotes('travel', d.travel);
          break;
        }
        case 'mainQuestions': {
          const d = payload.data as { food?: string; travel?: string };
          if (d?.food?.trim()) cfg.mainQuestions.food = d.food.trim();
          if (d?.travel?.trim()) cfg.mainQuestions.travel = d.travel.trim();
          saveAiConfig(cfg);
          applyMainQuestions();
          break;
        }
        case 'personas': {
          const d = payload.data as { food?: Persona[]; travel?: Persona[] };
          for (const roomId of ['food', 'travel'] as const) {
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
            'roomContextFood',
            'roomContextTravel',
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
          domainNotes: { food: domainNotes('food'), travel: domainNotes('travel') },
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

  socket.on('disconnect', (reason) => {
    const playerId = socket.data.playerId as string | undefined;
    if (playerId) engine.setConnected(playerId, false);
    console.log(`[socket] disconnect id=${socket.id} reason=${reason} playerId=${playerId || '-'}`);
  });
});

server.listen(config.port, () => {
  console.log(`[boot] Who is AI server listening on 0.0.0.0:${config.port}`);
  console.log(`[boot] publicDir=${publicDir} exists=${hasPublic}`);
  console.log(`[boot] health probe: GET /health`);
  console.log(`[boot] LLM: ${config.openaiBaseUrl} (${config.modelPrimary} -> ${config.modelFallback})`);
});
