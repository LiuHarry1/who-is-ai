import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSocket, emitAck } from '../socket';
import Countdown from '../components/Countdown';
import AdminPanel from '../components/AdminPanel';
import {
  PHASE_LABEL,
  PHASE_ORDER,
  ROOM_LABEL,
  voteTargets,
  type HostRoom,
  type HostState,
  type Phase,
  type RecapReport,
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
      <div className="max-w-3xl">
        {state.rooms
          .filter((room) => room.id === state.activeRoom)
          .map((room) => (
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
        className="w-full max-w-sm surface rounded-2xl p-6 space-y-4 anim-rise"
        onSubmit={(e) => {
          e.preventDefault();
          if (key) onAuth(key);
        }}
      >
        <div className="text-center space-y-1">
          <div className="text-[11px] tracking-[0.2em] uppercase text-[var(--muted)]">Host Console</div>
          <h1 className="font-display text-2xl font-bold">主持人控制台</h1>
        </div>
        <input
          autoFocus
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="主持人口令"
          className="field w-full rounded-xl px-4 py-3"
        />
        {error && <div className="text-[var(--danger)] text-sm">{error}</div>}
        <button className="btn-primary w-full rounded-xl py-3">进入</button>
      </form>
    </div>
  );
}

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
  const [maxHumansDraft, setMaxHumansDraft] = useState(String(state.maxHumans));
  const idx = PHASE_ORDER.indexOf(state.phase);
  const humanCount =
    state.rooms.find((r) => r.id === state.activeRoom)?.players.filter((p) => !p.isAI).length ?? 0;

  useEffect(() => {
    setMaxHumansDraft(String(state.maxHumans));
  }, [state.maxHumans]);

  return (
    <div className="surface rounded-2xl p-4 space-y-4 anim-rise">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--muted)]">Control Deck</div>
          <h1 className="font-display text-xl font-bold">Who is AI? 主持人控制台</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Countdown endsAt={state.phaseEndsAt} offset={offset} />
          <button onClick={onAdmin} className="chip rounded-xl px-4 py-2 text-sm hover:border-[rgba(212,165,116,0.4)]">
            设置
          </button>
          <button onClick={onBigScreen} className="btn-copper rounded-xl px-4 py-2 text-sm">
            揭晓大屏
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--muted)]">本局房间</span>
        {state.rooms.map((r) => (
          <button
            key={r.id}
            disabled={state.phase !== 'LOBBY'}
            onClick={() => {
              void hostAction({ type: 'setActiveRoom', roomId: r.id }).then((res) => {
                if (!res.ok && res.error) alert(res.error);
              });
            }}
            className={`text-xs rounded-lg px-3 py-1.5 transition disabled:cursor-not-allowed ${
              r.id === state.activeRoom ? 'chip-active' : 'chip disabled:opacity-40'
            }`}
          >
            {ROOM_LABEL[r.id].emoji} {r.title}
          </button>
        ))}
        {state.phase !== 'LOBBY' && <span className="text-xs text-[var(--muted)]/60">（仅大厅可切换）</span>}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--muted)]">人类人数上限</span>
        <input
          type="number"
          min={1}
          max={50}
          value={maxHumansDraft}
          onChange={(e) => setMaxHumansDraft(e.target.value)}
          className="field w-20 rounded-lg px-2 py-1 text-sm"
        />
        <button
          onClick={() => {
            void hostAction({ type: 'setMaxHumans', maxHumans: Number(maxHumansDraft) }).then((res) => {
              if (!res.ok && res.error) alert(res.error);
            });
          }}
          className="chip text-xs rounded-lg px-3 py-1.5 hover:border-[rgba(212,165,116,0.4)]"
        >
          保存上限
        </button>
        <span className="text-xs text-[var(--muted)]">
          已加入人类 <span className="text-[var(--text)] font-bold">{humanCount}</span>
          {' / '}
          上限 <span className="text-[var(--text)] font-bold">{state.maxHumans}</span>
          <span className="text-[var(--muted)]/60 ml-1">（不含 AI）</span>
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PHASE_ORDER.map((p, i) => (
          <button
            key={p}
            onClick={() => void hostAction({ type: 'goto', phase: p })}
            className={`text-xs rounded-lg px-2.5 py-1.5 border transition ${
              p === state.phase
                ? 'border-[rgba(61,155,143,0.55)] bg-[rgba(61,155,143,0.18)] text-[var(--signal-bright)] font-bold'
                : i < idx
                  ? 'border-transparent bg-[rgba(26,33,43,0.5)] text-[var(--muted)]/50'
                  : 'chip'
            }`}
          >
            {i + 1}.{PHASE_LABEL[p]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => void hostAction({ type: 'prev' })} className="chip rounded-xl px-4 py-2 text-sm">
          ← 上一阶段
        </button>
        <button onClick={() => void hostAction({ type: 'next' })} className="btn-primary rounded-xl px-4 py-2 text-sm">
          下一阶段 →
        </button>
        <button
          onClick={() => void hostAction({ type: 'extend', seconds: 60 })}
          className="chip rounded-xl px-4 py-2 text-sm"
        >
          加时 1 分钟
        </button>
        <button
          onClick={() => {
            if (confirm('确定要重置整局游戏吗？所有玩家和记录将被清空！')) {
              void hostAction({ type: 'reset' });
            }
          }}
          className="rounded-xl px-4 py-2 text-sm ml-auto border border-[rgba(224,122,106,0.35)] bg-[rgba(224,122,106,0.1)] text-[var(--danger)] hover:bg-[rgba(224,122,106,0.18)]"
        >
          重置游戏
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={announce}
          onChange={(e) => setAnnounce(e.target.value)}
          placeholder="以主持人身份向本局房间广播…"
          className="field flex-1 rounded-xl px-3 py-2 text-sm"
        />
        <button
          onClick={() => {
            if (announce.trim()) {
              void hostAction({ type: 'announce', roomId: 'all', text: announce.trim() });
              setAnnounce('');
            }
          }}
          className="chip rounded-xl px-4 py-2 text-sm hover:border-[rgba(212,165,116,0.4)]"
        >
          广播
        </button>
      </div>
    </div>
  );
}

function AIModelInput({ playerId, model }: { playerId: string; model: string }) {
  const [value, setValue] = useState(model);
  useEffect(() => setValue(model), [model]);
  return (
    <input
      className="field block w-full max-w-xs rounded-lg px-2 py-1 text-xs font-mono"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() && value.trim() !== model) {
          void hostAction({ type: 'setAIModel', playerId, model: value.trim() });
        }
      }}
      placeholder="模型名"
    />
  );
}

function RoomPanel({ room, phase }: { room: HostRoom; phase: Phase }) {
  const [tab, setTab] = useState<'players' | 'chat' | 'votes'>('players');
  const humans = room.players.filter((p) => !p.isAI);
  const ais = room.players.filter((p) => p.isAI);

  return (
    <div className="surface rounded-2xl p-4 space-y-3 anim-rise-delay-1">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-display font-semibold">
            {ROOM_LABEL[room.id].emoji} {room.title}
          </span>
          <span className="text-xs text-[var(--muted)] ml-2">
            {humans.length} 人 + {ais.length} AI
          </span>
        </div>
        {phase === 'LOBBY' && (
          <div className="flex gap-1.5">
            <button
              onClick={() => void hostAction({ type: 'addAI', roomId: room.id })}
              className="chip text-xs rounded-lg px-2.5 py-1.5"
            >
              + AI
            </button>
            <button
              onClick={() => void hostAction({ type: 'removeAI', roomId: room.id })}
              className="chip text-xs rounded-lg px-2.5 py-1.5"
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
            className={`text-xs rounded-lg px-3 py-1.5 ${tab === t ? 'chip-active' : 'chip'}`}
          >
            {t === 'players' ? '玩家' : t === 'chat' ? '聊天' : '投票'}
          </button>
        ))}
      </div>

      {tab === 'players' && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--muted)] text-xs text-left">
              <th className="py-1">代号</th>
              <th>真名 / 模型</th>
              <th className="text-center">R1票</th>
              <th className="text-center">R2票</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {room.players.map((p) => (
              <tr key={p.id} className="border-t border-[var(--line)]">
                <td className="py-2 font-mono">
                  {p.codename || '待分配'}
                  {!p.connected && !p.isAI && (
                    <span className="text-[var(--danger)] text-xs ml-1">离线</span>
                  )}
                </td>
                <td>
                  {p.isAI ? (
                    <div className="space-y-1">
                      <span className="text-[var(--danger)] font-bold">{p.realName}</span>
                      <AIModelInput playerId={p.id} model={p.model} />
                    </div>
                  ) : (
                    <>
                      {p.realName}
                      {p.userId && <span className="text-[var(--signal-bright)] text-xs ml-1">({p.userId})</span>}
                    </>
                  )}
                </td>
                <td className="text-center">{p.votesR1}</td>
                <td className="text-center">{p.votesR2}</td>
                <td className="text-right">
                  {p.revealed ? (
                    <span className="text-xs text-[var(--copper)]">已揭晓</span>
                  ) : (
                    <button
                      onClick={() => void hostAction({ type: 'reveal', playerId: p.id })}
                      className="chip text-xs rounded px-2 py-1 hover:border-[rgba(212,165,116,0.45)]"
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
        <div className="max-h-80 overflow-y-auto space-y-2 text-sm">
          {room.messages.map((m) => (
            <div key={m.id} className={m.system ? 'text-[var(--warn)] text-xs' : ''}>
              <span className="text-[var(--muted)] font-mono text-xs">{m.codename}</span>{' '}
              <span className="break-words">{m.text}</span>
            </div>
          ))}
          {room.messages.length === 0 && <div className="text-[var(--muted)] text-xs">暂无消息</div>}
        </div>
      )}

      {tab === 'votes' && (
        <div className="space-y-3 text-sm max-h-80 overflow-y-auto">
          {(['r1', 'r2'] as const).map((r) => (
            <div key={r}>
              <div className="text-xs text-[var(--muted)] font-bold mb-1">
                第{r === 'r1' ? '一' : '二'}轮（{room.votes[r].length} 票）
              </div>
              {room.votes[r].map((v, i) => {
                const voter = room.players.find((p) => p.id === v.voterId);
                const targets = voteTargets(v)
                  .map((id) => room.players.find((p) => p.id === id)?.codename ?? '?')
                  .join('、');
                return (
                  <div key={i} className="text-xs py-1 border-t border-[var(--line)]">
                    <span className="font-mono">{voter?.codename ?? '?'}</span>
                    {voter?.isAI && <span className="text-[var(--danger)]">(AI)</span>} →{' '}
                    <span className="font-mono font-bold text-[var(--copper)]">{targets}</span>
                    <span className="text-[var(--muted)] ml-2">{v.reason}</span>
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

function BigScreen({ state, onExit }: { state: HostState; onExit: () => void }) {
  const [step, setStep] = useState(0);
  const room = state.rooms.find((r) => r.id === state.activeRoom) ?? state.rooms[0];

  return (
    <div className="min-h-full p-6 sm:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-display text-3xl font-bold">
          揭晓时刻 — <span className="text-[var(--signal-bright)]">{room.title}</span>
        </h1>
        <button onClick={onExit} className="chip rounded-xl px-4 py-2 text-sm">
          退出大屏
        </button>
      </div>

      {state.outcome && (
        <div
          className={`rounded-2xl px-6 py-4 text-2xl font-display font-bold text-center border-2 anim-rise ${
            state.outcome === 'human'
              ? 'bg-[rgba(61,155,143,0.12)] border-[rgba(61,155,143,0.5)] text-[var(--signal-bright)]'
              : 'bg-[rgba(224,122,106,0.12)] border-[rgba(224,122,106,0.5)] text-[var(--danger)]'
          }`}
        >
          {state.outcome === 'human' ? '人类阵营获胜' : 'AI 阵营获胜'}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {['① 投票对比', '② 逐个揭晓', '③ LLM 复盘', '④ 颁奖'].map((label, i) => (
          <button
            key={i}
            onClick={() => setStep(i)}
            className={`rounded-xl px-5 py-2.5 font-semibold ${step === i ? 'btn-copper' : 'chip text-[var(--muted)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {step === 0 && <VoteCompare room={room} />}
      {step === 1 && <StepReveal room={room} />}
      {step === 2 && <RecapView recap={state.recap} />}
      {step === 3 && <Awards state={state} />}
    </div>
  );
}

function VoteCompare({ room }: { room: HostRoom }) {
  const max = Math.max(1, ...room.players.map((p) => Math.max(p.votesR1, p.votesR2)));
  const sorted = [...room.players].sort((a, b) => b.votesR2 - a.votesR2);
  return (
    <div className="surface rounded-2xl p-6 space-y-4">
      <div className="text-[var(--muted)] text-sm">
        两轮得票对比 — <span className="text-[var(--signal-bright)]">■ 第一轮</span>{' '}
        <span className="text-[var(--copper)]">■ 第二轮</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[var(--muted)] text-xs text-left">
            <th className="py-1">玩家</th>
            <th className="text-center">第一轮</th>
            <th className="text-center">第二轮</th>
            <th className="text-center">变化</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id} className="border-t border-[var(--line)]">
              <td className="py-2 font-mono font-bold">
                {p.codename}
                {p.revealed && (p.isAI ? ' · AI' : ` (${p.realName})`)}
              </td>
              <td className="text-center text-[var(--signal-bright)]">{p.votesR1}</td>
              <td className="text-center text-[var(--copper)]">{p.votesR2}</td>
              <td className="text-center">
                {p.votesR2 - p.votesR1 >= 0 ? `+${p.votesR2 - p.votesR1}` : p.votesR2 - p.votesR1}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-2 pt-2">
        {sorted.map((p) => (
          <div key={p.id} className="h-3 bg-[var(--ink-3)] rounded overflow-hidden">
            <div className="h-1.5 bg-[var(--signal)]" style={{ width: `${(p.votesR1 / max) * 100}%` }} />
            <div className="h-1.5 bg-[var(--copper)]" style={{ width: `${(p.votesR2 / max) * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StepReveal({ room }: { room: HostRoom }) {
  const order = useMemo(
    () => [...room.players].sort((a, b) => a.votesR2 - b.votesR2 || a.votesR1 - b.votesR1),
    [room.players],
  );
  const nextToReveal = order.find((p) => !p.revealed);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          disabled={!nextToReveal}
          onClick={() => nextToReveal && void hostAction({ type: 'reveal', playerId: nextToReveal.id })}
          className="btn-copper rounded-xl px-6 py-3 text-lg disabled:opacity-40"
        >
          {nextToReveal
            ? `揭晓下一位：${nextToReveal.codename}（${nextToReveal.votesR2} 票）`
            : '全部揭晓完毕'}
        </button>
        <button onClick={() => void hostAction({ type: 'revealAll' })} className="chip rounded-xl px-4 py-3 text-sm">
          一键全揭
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {order.map((p) => (
          <div
            key={p.id}
            className={`rounded-2xl border-2 p-4 text-center transition-all ${
              p.revealed
                ? p.isAI
                  ? 'bg-[rgba(224,122,106,0.14)] border-[rgba(224,122,106,0.55)] scale-[1.02]'
                  : 'bg-[rgba(61,155,143,0.12)] border-[rgba(61,155,143,0.45)]'
                : 'surface'
            }`}
          >
            <div className="text-xl font-display font-bold font-mono">{p.codename}</div>
            <div className="text-xs text-[var(--muted)] mt-1">第二轮 {p.votesR2} 票</div>
            <div className="mt-2 text-lg">
              {p.revealed ? (
                p.isAI ? (
                  <span className="text-[var(--danger)] font-bold">是 AI</span>
                ) : (
                  <span className="text-[var(--signal-bright)]">
                    {p.realName}
                    {p.userId && <span className="block text-sm text-[var(--muted)]">{p.userId}</span>}
                  </span>
                )
              ) : (
                <span className="text-[var(--muted)]/50">？？？</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecapView({ recap }: { recap: RecapReport | null }) {
  if (!recap) {
    return (
      <div className="surface rounded-2xl p-8 text-center text-[var(--muted)]">
        LLM 复盘生成中，请稍候…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface rounded-2xl p-6 space-y-2">
        <div className="font-display text-xl font-bold">投票变化点评</div>
        <p className="text-[var(--text)]/90 leading-relaxed">{recap.voteCommentary}</p>
      </div>
      <div className="surface rounded-2xl p-6 space-y-3">
        <div className="font-display text-xl font-bold">最像真人的 AI 发言</div>
        {recap.humanLikeAi.length === 0 && <div className="text-[var(--muted)] text-sm">暂无</div>}
        {recap.humanLikeAi.map((h, i) => (
          <div key={i} className="border-t border-[var(--line)] pt-3">
            <div className="font-mono text-sm text-[var(--copper)]">{h.codename}</div>
            <blockquote className="font-display text-lg my-1">「{h.text}」</blockquote>
            <div className="text-sm text-[var(--muted)]">{h.analysis}</div>
          </div>
        ))}
      </div>
      <div className="surface rounded-2xl p-6 space-y-3">
        <div className="font-display text-xl font-bold">最像 AI 的人类发言</div>
        {recap.aiLikeHuman.length === 0 && <div className="text-[var(--muted)] text-sm">暂无</div>}
        {recap.aiLikeHuman.map((h, i) => (
          <div key={i} className="border-t border-[var(--line)] pt-3">
            <div className="font-mono text-sm text-[var(--signal-bright)]">{h.codename}</div>
            <blockquote className="font-display text-lg my-1">「{h.text}」</blockquote>
            <div className="text-sm text-[var(--muted)]">{h.analysis}</div>
          </div>
        ))}
      </div>
      {recap.behaviorNotes && (
        <div className="surface rounded-2xl p-6 space-y-2">
          <div className="font-display text-xl font-bold">行为变化点评</div>
          <p className="text-[var(--text)]/90 leading-relaxed">{recap.behaviorNotes}</p>
        </div>
      )}
    </div>
  );
}

function Awards({ state }: { state: HostState }) {
  const { detectives, actors, ais } = state.awards;
  const card = 'surface rounded-2xl p-6 space-y-3';
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className={card}>
        <div className="font-display text-xl font-bold">最强侦探</div>
        <div className="text-xs text-[var(--muted)]">两轮投票猜中 AI 次数最多</div>
        {detectives.map((d, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span>
              {['①', '②', '③'][i]} {d.codename}{' '}
              <span className="text-[var(--muted)]">
                ({d.realName}
                {d.userId ? ` · ${d.userId}` : ''})
              </span>
            </span>
            <span className="font-bold text-[var(--copper)]">{d.score} 中</span>
          </div>
        ))}
      </div>
      <div className={card}>
        <div className="font-display text-xl font-bold">最强演员</div>
        <div className="text-xs text-[var(--muted)]">被误认为 AI 最多的人类</div>
        {actors.map((a, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span>
              {['①', '②', '③'][i]} {a.codename}{' '}
              <span className="text-[var(--muted)]">
                ({a.realName}
                {a.userId ? ` · ${a.userId}` : ''})
              </span>
            </span>
            <span className="font-bold text-[var(--copper)]">{a.votes} 票</span>
          </div>
        ))}
      </div>
      <div className={card}>
        <div className="font-display text-xl font-bold">最强 AI</div>
        <div className="text-xs text-[var(--muted)]">得票最少、最难被识别</div>
        {ais.map((a, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span>
              {['①', '②', '③'][i]} {a.codename}{' '}
              <span className="text-[var(--muted)]">({a.realName})</span>
            </span>
            <span className="font-bold text-[var(--copper)]">{a.votes} 票</span>
          </div>
        ))}
      </div>
    </div>
  );
}
