import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSocket, emitAck } from '../socket';
import Countdown from '../components/Countdown';
import AdminPanel from '../components/AdminPanel';
import {
  PHASE_LABEL,
  PHASE_ORDER,
  type HostRoom,
  type HostState,
  type Phase,
} from '../types';

const KEY_STORAGE = 'whoisai_host_key';

export default function Host() {
  const [params] = useSearchParams();
  const [state, setState] = useState<HostState | null>(null);
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<'panel' | 'big' | 'admin'>('panel');

  const auth = async (key: string) => {
    const res = await emitAck<{ ok: boolean; error?: string; state?: HostState }>('host:auth', { key });
    if (res.ok && res.state) {
      localStorage.setItem(KEY_STORAGE, key);
      setAuthed(true);
      setState(res.state);
      setOffset(res.state.now - Date.now());
      setError('');
    } else {
      setError(res.error ?? '认证失败');
    }
  };

  useEffect(() => {
    const socket = getSocket();
    const onState = (s: HostState) => {
      setState(s);
      setOffset(s.now - Date.now());
    };
    const onConnect = () => {
      const key = params.get('key') || localStorage.getItem(KEY_STORAGE);
      if (key) void auth(key);
    };
    socket.on('host:state', onState);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('host:state', onState);
      socket.off('connect', onConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authed || !state) {
    return <AuthForm error={error} onAuth={(k) => void auth(k)} />;
  }

  if (view === 'big') {
    return <BigScreen state={state} onExit={() => setView('panel')} />;
  }
  if (view === 'admin') {
    return <AdminPanel onExit={() => setView('panel')} />;
  }

  return (
    <div className="min-h-full p-4 max-w-7xl mx-auto space-y-4">
      <ControlBar
        state={state}
        offset={offset}
        onBigScreen={() => setView('big')}
        onAdmin={() => setView('admin')}
      />
      <div className="grid lg:grid-cols-2 gap-4">
        {state.rooms.map((room) => (
          <RoomPanel key={room.id} room={room} phase={state.phase} />
        ))}
      </div>
    </div>
  );
}

function AuthForm({ error, onAuth }: { error: string; onAuth: (key: string) => void }) {
  const [key, setKey] = useState('');
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <form
        className="w-full max-w-xs space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (key) onAuth(key);
        }}
      >
        <h1 className="text-xl font-bold text-center">主持人控制台</h1>
        <input
          autoFocus
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="主持人口令"
          className="w-full rounded-xl bg-slate-800 border border-slate-700 px-4 py-3 outline-none focus:border-emerald-500"
        />
        {error && <div className="text-red-400 text-sm">{error}</div>}
        <button className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 py-3 font-bold">
          进入
        </button>
      </form>
    </div>
  );
}

// ---------- 控制条 ----------

function hostAction(payload: Record<string, unknown>) {
  return emitAck('host:action', payload);
}

function ControlBar({
  state,
  offset,
  onBigScreen,
  onAdmin,
}: {
  state: HostState;
  offset: number;
  onBigScreen: () => void;
  onAdmin: () => void;
}) {
  const [announce, setAnnounce] = useState('');
  const idx = PHASE_ORDER.indexOf(state.phase);

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-black text-lg">
          🎛️ Who is AI? 主持人控制台
        </h1>
        <div className="flex items-center gap-3">
          <Countdown endsAt={state.phaseEndsAt} offset={offset} />
          <button
            onClick={onAdmin}
            className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm"
          >
            ⚙️ 设置
          </button>
          <button
            onClick={onBigScreen}
            className="rounded-xl bg-amber-600 hover:bg-amber-500 px-4 py-2 text-sm font-bold"
          >
            🎬 揭晓大屏
          </button>
        </div>
      </div>

      {/* 阶段导航 */}
      <div className="flex flex-wrap gap-1.5">
        {PHASE_ORDER.map((p, i) => (
          <button
            key={p}
            onClick={() => void hostAction({ type: 'goto', phase: p })}
            className={`text-xs rounded-lg px-2.5 py-1.5 border transition ${
              p === state.phase
                ? 'bg-emerald-600 border-emerald-400 font-bold'
                : i < idx
                  ? 'bg-slate-800 border-slate-700 text-slate-500'
                  : 'bg-slate-800 border-slate-700 hover:border-slate-500'
            }`}
          >
            {i + 1}.{PHASE_LABEL[p]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void hostAction({ type: 'prev' })}
          className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm"
        >
          ← 上一阶段
        </button>
        <button
          onClick={() => void hostAction({ type: 'next' })}
          className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-sm font-bold"
        >
          下一阶段 →
        </button>
        <button
          onClick={() => void hostAction({ type: 'extend', seconds: 60 })}
          className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm"
        >
          ⏱ 加时 1 分钟
        </button>
        <button
          onClick={() => {
            if (confirm('确定要重置整局游戏吗？所有玩家和记录将被清空！')) {
              void hostAction({ type: 'reset' });
            }
          }}
          className="rounded-xl bg-red-900 hover:bg-red-800 px-4 py-2 text-sm ml-auto"
        >
          ♻️ 重置游戏
        </button>
      </div>

      {/* 广播 */}
      <div className="flex gap-2">
        <input
          value={announce}
          onChange={(e) => setAnnounce(e.target.value)}
          placeholder="以主持人身份向两个房间广播消息…"
          className="flex-1 rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button
          onClick={() => {
            if (announce.trim()) {
              void hostAction({ type: 'announce', roomId: 'all', text: announce.trim() });
              setAnnounce('');
            }
          }}
          className="rounded-xl bg-slate-700 hover:bg-slate-600 px-4 py-2 text-sm"
        >
          广播
        </button>
      </div>
    </div>
  );
}

// ---------- 房间面板 ----------

function RoomPanel({ room, phase }: { room: HostRoom; phase: Phase }) {
  const [tab, setTab] = useState<'players' | 'chat' | 'votes'>('players');
  const humans = room.players.filter((p) => !p.isAI);
  const ais = room.players.filter((p) => p.isAI);

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-bold">{room.id === 'tech' ? '💻' : '🌍'} {room.title}</span>
          <span className="text-xs text-slate-400 ml-2">
            {humans.length} 人 + {ais.length} AI
          </span>
        </div>
        {phase === 'LOBBY' && (
          <div className="flex gap-1.5">
            <button
              onClick={() => void hostAction({ type: 'addAI', roomId: room.id })}
              className="text-xs rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5"
            >
              + AI
            </button>
            <button
              onClick={() => void hostAction({ type: 'removeAI', roomId: room.id })}
              className="text-xs rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5"
            >
              - AI
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-1.5">
        {(['players', 'chat', 'votes'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs rounded-lg px-3 py-1.5 ${
              tab === t ? 'bg-slate-700 font-bold' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {t === 'players' ? '玩家' : t === 'chat' ? '聊天' : '投票'}
          </button>
        ))}
      </div>

      {tab === 'players' && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs text-left">
              <th className="py-1">代号</th>
              <th>真名</th>
              <th className="text-center">R1票</th>
              <th className="text-center">R2票</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {room.players.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="py-1.5 font-mono">
                  {p.codename || '待分配'}
                  {!p.connected && !p.isAI && <span className="text-red-400 text-xs ml-1">离线</span>}
                </td>
                <td>
                  {p.isAI ? (
                    <span className="text-red-400 font-bold">🤖 {p.realName}</span>
                  ) : (
                    p.realName
                  )}
                </td>
                <td className="text-center">{p.votesR1}</td>
                <td className="text-center">{p.votesR2}</td>
                <td className="text-right">
                  {p.revealed ? (
                    <span className="text-xs text-amber-400">已揭晓</span>
                  ) : (
                    <button
                      onClick={() => void hostAction({ type: 'reveal', playerId: p.id })}
                      className="text-xs rounded bg-slate-800 hover:bg-amber-700 px-2 py-1"
                    >
                      揭晓
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'chat' && (
        <div className="max-h-80 overflow-y-auto space-y-1.5 text-sm">
          {room.messages.map((m) => (
            <div key={m.id} className={m.system ? 'text-amber-400 text-xs' : ''}>
              <span className="text-slate-500 font-mono text-xs">{m.codename}</span>{' '}
              <span className="break-words">{m.text}</span>
            </div>
          ))}
          {room.messages.length === 0 && <div className="text-slate-600 text-xs">暂无消息</div>}
        </div>
      )}

      {tab === 'votes' && (
        <div className="space-y-3 text-sm max-h-80 overflow-y-auto">
          {(['r1', 'r2'] as const).map((r) => (
            <div key={r}>
              <div className="text-xs text-slate-500 font-bold mb-1">
                第{r === 'r1' ? '一' : '二'}轮（{room.votes[r].length} 票）
              </div>
              {room.votes[r].map((v, i) => {
                const voter = room.players.find((p) => p.id === v.voterId);
                const target = room.players.find((p) => p.id === v.targetId);
                return (
                  <div key={i} className="text-xs py-0.5 border-t border-slate-800">
                    <span className="font-mono">{voter?.codename ?? '?'}</span>
                    {voter?.isAI && <span className="text-red-400">(AI)</span>} →{' '}
                    <span className="font-mono font-bold">{target?.codename ?? '?'}</span>
                    <span className="text-slate-400 ml-2">{v.reason}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 揭晓大屏 ----------

function BigScreen({ state, onExit }: { state: HostState; onExit: () => void }) {
  const [roomIdx, setRoomIdx] = useState(0);
  const [step, setStep] = useState(0); // 0=投票对比 1=逐个揭晓 2=奖项
  const room = state.rooms[roomIdx];

  return (
    <div className="min-h-full p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-black">
          🎬 揭晓时刻 — <span className="text-emerald-400">{room.title}</span>
        </h1>
        <div className="flex gap-2">
          {state.rooms.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setRoomIdx(i)}
              className={`rounded-xl px-4 py-2 text-sm ${
                i === roomIdx ? 'bg-emerald-600 font-bold' : 'bg-slate-800'
              }`}
            >
              {r.title}
            </button>
          ))}
          <button onClick={onExit} className="rounded-xl bg-slate-800 px-4 py-2 text-sm">
            退出大屏
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {['① 投票对比', '② 逐个揭晓', '③ 颁奖'].map((label, i) => (
          <button
            key={i}
            onClick={() => setStep(i)}
            className={`rounded-xl px-5 py-2.5 font-bold ${
              step === i ? 'bg-amber-600' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {step === 0 && <VoteCompare room={room} />}
      {step === 1 && <StepReveal room={room} />}
      {step === 2 && <Awards state={state} />}
    </div>
  );
}

function VoteCompare({ room }: { room: HostRoom }) {
  const max = Math.max(1, ...room.players.map((p) => Math.max(p.votesR1, p.votesR2)));
  const sorted = [...room.players].sort((a, b) => b.votesR2 - a.votesR2);
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
      <div className="text-slate-400 text-sm">
        两轮"谁是 AI"得票对比 — <span className="text-sky-400">■ 第一轮</span>{' '}
        <span className="text-amber-400">■ 第二轮</span>
      </div>
      {sorted.map((p) => (
        <div key={p.id} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="font-mono font-bold">
              {p.codename}
              {p.revealed && (p.isAI ? ' 🤖' : ` (${p.realName})`)}
            </span>
            <span className="text-slate-400">
              {p.votesR1} → {p.votesR2}
            </span>
          </div>
          <div className="h-3 bg-slate-800 rounded overflow-hidden">
            <div className="h-1.5 bg-sky-500" style={{ width: `${(p.votesR1 / max) * 100}%` }} />
            <div className="h-1.5 bg-amber-500" style={{ width: `${(p.votesR2 / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StepReveal({ room }: { room: HostRoom }) {
  // 按第二轮票数从低到高排序（先揭"最像真人"的，最后揭"最像 AI"的）
  const order = useMemo(
    () => [...room.players].sort((a, b) => a.votesR2 - b.votesR2 || a.votesR1 - b.votesR1),
    [room.players],
  );
  const nextToReveal = order.find((p) => !p.revealed);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          disabled={!nextToReveal}
          onClick={() => nextToReveal && void hostAction({ type: 'reveal', playerId: nextToReveal.id })}
          className="rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 px-6 py-3 font-bold text-lg"
        >
          {nextToReveal ? `揭晓下一位：${nextToReveal.codename}（${nextToReveal.votesR2} 票）` : '全部揭晓完毕'}
        </button>
        <button
          onClick={() => void hostAction({ type: 'revealAll' })}
          className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-3 text-sm"
        >
          一键全揭
        </button>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
        {order.map((p) => (
          <div
            key={p.id}
            className={`rounded-2xl border-2 p-4 text-center transition-all ${
              p.revealed
                ? p.isAI
                  ? 'bg-red-950/70 border-red-600 scale-105'
                  : 'bg-emerald-950/60 border-emerald-700'
                : 'bg-slate-900 border-slate-700'
            }`}
          >
            <div className="text-xl font-black font-mono">{p.codename}</div>
            <div className="text-xs text-slate-400 mt-1">第二轮 {p.votesR2} 票</div>
            <div className="mt-2 text-lg">
              {p.revealed ? (
                p.isAI ? (
                  <span className="text-red-400 font-black">🤖 是 AI！</span>
                ) : (
                  <span className="text-emerald-300">🧑 {p.realName}</span>
                )
              ) : (
                <span className="text-slate-600">？？？</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Awards({ state }: { state: HostState }) {
  const { detectives, actors, ais } = state.awards;
  const card = 'rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-3';
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className={card}>
        <div className="text-xl font-black">🕵️ 最强侦探</div>
        <div className="text-xs text-slate-500">两轮投票猜中 AI 次数最多</div>
        {detectives.map((d, i) => (
          <div key={i} className="flex justify-between">
            <span>
              {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} {d.codename}{' '}
              <span className="text-slate-400">({d.realName})</span>
            </span>
            <span className="font-bold">{d.score} 中</span>
          </div>
        ))}
      </div>
      <div className={card}>
        <div className="text-xl font-black">🎭 最强演员</div>
        <div className="text-xs text-slate-500">被误认为 AI 最多的人类</div>
        {actors.map((a, i) => (
          <div key={i} className="flex justify-between">
            <span>
              {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} {a.codename}{' '}
              <span className="text-slate-400">({a.realName})</span>
            </span>
            <span className="font-bold">{a.votes} 票</span>
          </div>
        ))}
      </div>
      <div className={card}>
        <div className="text-xl font-black">🤖 最强 AI</div>
        <div className="text-xs text-slate-500">得票最少、最难被识别的 AI</div>
        {ais.map((a, i) => (
          <div key={i} className="flex justify-between">
            <span>
              {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} {a.codename}{' '}
              <span className="text-slate-400">({a.realName})</span>
            </span>
            <span className="font-bold">{a.votes} 票</span>
          </div>
        ))}
      </div>
    </div>
  );
}
