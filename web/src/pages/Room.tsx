import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSocket, emitAck } from '../socket';
import { getUserId } from '../userId';
import Countdown from '../components/Countdown';
import { isSoundEnabled, playCue, setSoundEnabled, vibrateShort } from '../sound';
import {
  PHASE_LABEL,
  PHASE_ORDER,
  voteTargets,
  type Phase,
  type PublicState,
  type RecapReport,
  type RoomId,
  type Vote,
} from '../types';

const TOKEN_KEY = 'whoisai_token';

interface JoinAck {
  ok: boolean;
  error?: string;
  playerId?: string;
  token?: string;
  roomId?: RoomId;
  state?: PublicState;
  myVotes?: { r1: Vote | null; r2: Vote | null };
}

export default function Room() {
  const { roomId } = useParams<{ roomId: RoomId }>();
  const [state, setState] = useState<PublicState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [myVotes, setMyVotes] = useState<{ r1: Vote | null; r2: Vote | null }>({ r1: null, r2: null });
  const [joinError, setJoinError] = useState('');
  const [needJoin, setNeedJoin] = useState(false);
  const [connected, setConnected] = useState(true);
  const offsetRef = useRef(0);

  const tryJoin = useCallback(
    async (name?: string) => {
      const token = localStorage.getItem(TOKEN_KEY) ?? undefined;
      const res = await emitAck<JoinAck>('join', {
        roomId,
        name,
        userId: name ? getUserId() : undefined,
        token: name ? undefined : token,
      });
      if (res.ok && res.token && res.playerId && res.state) {
        localStorage.setItem(TOKEN_KEY, res.token);
        setPlayerId(res.playerId);
        setState(res.state);
        if (res.myVotes) setMyVotes(res.myVotes);
        offsetRef.current = res.state.now - Date.now();
        setNeedJoin(false);
        setJoinError('');
      } else if (name) {
        setJoinError(res.error ?? '加入失败');
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setNeedJoin(true);
      }
    },
    [roomId],
  );

  useEffect(() => {
    const socket = getSocket();
    const onState = (s: PublicState) => {
      setState(s);
      offsetRef.current = s.now - Date.now();
    };
    const onConnect = () => {
      setConnected(true);
      if (localStorage.getItem(TOKEN_KEY)) void tryJoin();
      else setNeedJoin(true);
    };
    const onDisconnect = () => setConnected(false);

    socket.on('state', onState);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();

    return () => {
      socket.off('state', onState);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [tryJoin]);

  if (needJoin || !state || !playerId) {
    return <JoinForm error={joinError} onJoin={(name) => void tryJoin(name)} pending={!needJoin} />;
  }

  return (
    <GameView
      state={state}
      playerId={playerId}
      myVotes={myVotes}
      setMyVotes={setMyVotes}
      offset={offsetRef.current}
      connected={connected}
    />
  );
}

function JoinForm({
  error,
  onJoin,
  pending,
}: {
  error: string;
  onJoin: (name: string) => void;
  pending: boolean;
}) {
  const [name, setName] = useState('');
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 anim-rise">
        <div className="text-center space-y-2">
          <div className="text-[11px] tracking-[0.2em] uppercase text-[var(--muted)]">Join Room</div>
          <h1 className="font-display text-3xl font-bold">
            加入 <span className="text-[var(--signal-bright)]">Who is AI?</span>
          </h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            输入真实姓名（仅主持人可见），进入后将分配匿名代号。
          </p>
        </div>
        {pending ? (
          <div className="surface rounded-2xl px-5 py-8 text-center text-sm text-[var(--muted)]">连接中…</div>
        ) : (
          <form
            className="surface rounded-2xl p-5 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) onJoin(name.trim());
            }}
          >
            <label className="block space-y-1.5">
              <span className="text-xs text-[var(--muted)]">真实姓名</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                placeholder="例如：小刘"
                className="field w-full rounded-xl px-4 py-3 text-sm"
              />
            </label>
            {error && <div className="text-[var(--danger)] text-sm">{error}</div>}
            <button type="submit" className="btn-primary w-full rounded-xl py-3">
              进入房间
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function PhaseProgress({ phase }: { phase: Phase }) {
  const idx = PHASE_ORDER.indexOf(phase);
  return (
    <div className="px-1">
      <div className="flex gap-1">
        {PHASE_ORDER.map((p, i) => (
          <div
            key={p}
            title={PHASE_LABEL[p]}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < idx
                ? 'bg-[var(--signal)]/45'
                : i === idx
                  ? 'bg-[var(--signal-bright)]'
                  : 'bg-[rgba(232,236,242,0.08)]'
            }`}
          />
        ))}
      </div>
      <div className="mt-1 text-[10px] text-[var(--muted)] tracking-wide">
        阶段 {idx + 1}/{PHASE_ORDER.length} · {PHASE_LABEL[phase]}
      </div>
    </div>
  );
}

function EmptyArt({ kind }: { kind: 'lobby' | 'chat' | 'intermission' }) {
  if (kind === 'lobby') {
    return (
      <svg width="88" height="88" viewBox="0 0 88 88" className="mx-auto text-[var(--signal-bright)]" aria-hidden>
        <circle cx="44" cy="44" r="36" fill="currentColor" opacity="0.08" />
        <circle cx="44" cy="44" r="22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5" className="spin-slow origin-center" style={{ transformOrigin: '44px 44px' }} />
        <circle cx="44" cy="44" r="4" fill="currentColor" />
        <circle cx="28" cy="32" r="3" fill="currentColor" opacity="0.55" />
        <circle cx="60" cy="36" r="3" fill="currentColor" opacity="0.55" />
        <circle cx="52" cy="58" r="3" fill="currentColor" opacity="0.55" />
      </svg>
    );
  }
  if (kind === 'intermission') {
    return (
      <svg width="96" height="96" viewBox="0 0 96 96" className="mx-auto text-[var(--copper)]" aria-hidden>
        <rect x="18" y="28" width="60" height="40" rx="10" fill="currentColor" opacity="0.12" />
        <path d="M30 48h36M38 40v16M58 40v16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
        <circle cx="48" cy="20" r="6" fill="currentColor" opacity="0.35" className="signal-dot" />
      </svg>
    );
  }
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="mx-auto text-[var(--muted)]" aria-hidden>
      <rect x="12" y="20" width="56" height="40" rx="12" fill="currentColor" opacity="0.12" />
      <path d="M24 36h20M24 46h32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

function GameView({
  state,
  playerId,
  myVotes,
  setMyVotes,
  offset,
  connected,
}: {
  state: PublicState;
  playerId: string;
  myVotes: { r1: Vote | null; r2: Vote | null };
  setMyVotes: React.Dispatch<React.SetStateAction<{ r1: Vote | null; r2: Vote | null }>>;
  offset: number;
  connected: boolean;
}) {
  const { phase, room } = state;
  const me = room.players.find((p) => p.id === playerId);
  const isChat = phase === 'ROUND1_CHAT' || phase === 'ROUND2_CHAT';
  const isVote = phase === 'ROUND1_VOTE' || phase === 'ROUND2_VOTE';
  const round: 1 | 2 = phase.startsWith('ROUND2') ? 2 : 1;
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [mentionInsert, setMentionInsert] = useState<string | null>(null);
  const prevPhase = useRef(phase);
  const prevMsgLen = useRef(room.messages.length);

  useEffect(() => {
    if (prevPhase.current !== phase) {
      playCue('phase');
      prevPhase.current = phase;
    }
  }, [phase]);

  useEffect(() => {
    if (room.messages.length > prevMsgLen.current) {
      const last = room.messages[room.messages.length - 1];
      if (last && !last.system && last.playerId !== playerId) {
        if (last.mentions.includes(playerId)) {
          playCue('mention');
          vibrateShort();
        } else {
          playCue('message');
        }
      }
      prevMsgLen.current = room.messages.length;
    } else {
      prevMsgLen.current = room.messages.length;
    }
  }, [room.messages, playerId]);

  const showChat = isChat || isVote || phase === 'REVEAL';
  const themeClass = room.id === 'food' ? 'room-theme-food' : 'room-theme-travel';

  return (
    <div className={`h-full flex flex-col max-w-2xl mx-auto ${themeClass}`}>
      <header className="shrink-0 px-4 py-3 border-b border-[var(--line)] bg-[rgba(11,14,18,0.8)] backdrop-blur-md space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-display font-semibold truncate">{room.title}</div>
            <div className="text-xs text-[var(--muted)] flex items-center gap-2 flex-wrap mt-0.5">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-[rgba(61,155,143,0.12)] text-[var(--signal-bright)] px-1.5 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--signal)]" />
                {PHASE_LABEL[phase]}
              </span>
              {me?.codename && <span className="text-[var(--copper)]">你是 {me.codename}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                setSoundEnabled(next);
                if (next) playCue('phase');
              }}
              className={`chip rounded-lg px-2.5 py-1 text-[11px] ${soundOn ? 'chip-active' : ''}`}
              title={soundOn ? '关闭提示音' : '开启提示音'}
            >
              {soundOn ? '音效开' : '音效关'}
            </button>
            {!connected && <span className="text-xs text-[var(--danger)]">重连中…</span>}
            <Countdown endsAt={state.phaseEndsAt} offset={offset} />
          </div>
        </div>
        <PhaseProgress phase={phase} />
        {(showChat || phase === 'INTERMISSION') && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {room.players
              .filter((p) => p.codename)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={p.id === playerId || !isChat}
                  onClick={() => {
                    if (p.id !== playerId && isChat) setMentionInsert(p.codename);
                  }}
                  className={`inline-flex items-center gap-1.5 shrink-0 rounded-full border px-2 py-0.5 text-[11px] transition ${
                    p.id === playerId
                      ? 'border-[rgba(61,155,143,0.45)] bg-[rgba(61,155,143,0.12)] text-[var(--signal-bright)]'
                      : isChat
                        ? 'border-[rgba(232,236,242,0.08)] bg-[rgba(26,33,43,0.65)] text-[var(--muted)] hover:border-[rgba(212,165,116,0.4)]'
                        : 'border-[rgba(232,236,242,0.08)] bg-[rgba(26,33,43,0.65)] text-[var(--muted)] opacity-70'
                  }`}
                  title={isChat && p.id !== playerId ? `点击 @${p.codename}` : p.connected ? '在线' : '离线'}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${p.connected || p.id === playerId ? 'bg-[var(--signal)]' : 'bg-[var(--muted)]/40'}`}
                  />
                  {p.codename}
                </button>
              ))}
          </div>
        )}
      </header>

      {phase === 'LOBBY' && <Lobby count={room.playerCount} />}
      {phase === 'RULES' && <Rules me={me?.codename ?? ''} question={room.mainQuestion} />}
      {phase === 'INTERMISSION' && <IntermissionPanel endsAt={state.phaseEndsAt} offset={offset} />}
      {showChat && (
        <ChatPanel
          state={state}
          playerId={playerId}
          readonly={!isChat}
          mentionInsert={mentionInsert}
          onMentionConsumed={() => setMentionInsert(null)}
        />
      )}

      {isVote && (
        <VotePanel
          state={state}
          playerId={playerId}
          round={round}
          myVote={round === 1 ? myVotes.r1 : myVotes.r2}
          onVoted={(v) => {
            playCue('vote');
            setMyVotes((prev) => (round === 1 ? { ...prev, r1: v } : { ...prev, r2: v }));
          }}
        />
      )}
      {phase === 'REVEAL' && <RevealPanel state={state} playerId={playerId} />}
    </div>
  );
}

function Lobby({ count }: { count: number }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center anim-rise">
      <EmptyArt kind="lobby" />
      <div className="space-y-2">
        <div className="font-display text-2xl font-semibold">已加入，等待开局</div>
        <div className="text-[var(--muted)] text-sm">
          当前房间 <span className="text-[var(--signal-bright)] font-semibold">{count}</span> 人
        </div>
      </div>
      <p className="text-sm text-[var(--muted)] max-w-xs leading-relaxed">
        开局后每人获得匿名代号。聊天室中至少隐藏着一个 AI。
      </p>
    </div>
  );
}

function Rules({ me, question }: { me: string; question: string }) {
  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4 anim-rise">
      <div className="surface rounded-2xl p-5 space-y-3">
        <h2 className="font-display text-lg font-semibold">游戏规则</h2>
        <ul className="text-sm text-[var(--text)]/90 space-y-2.5">
          {[
            '房间里至少混入了 1 个 AI，你的任务是找出它',
            '两轮聊天 + 两轮投票，第二轮投票决定胜负',
            '每轮每人最多发言 5 条，第一轮每人至少发言一次',
            '第二轮每人最多 @ 一人提问',
            '第一轮投票会影响 AI 的行为，注意观察变化',
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 rounded-full bg-[var(--copper)] shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>
      {me && (
        <div className="rounded-2xl border border-[rgba(61,155,143,0.35)] bg-[rgba(61,155,143,0.1)] p-5 text-center">
          <div className="text-xs tracking-widest uppercase text-[var(--signal-bright)]">你的匿名代号</div>
          <div className="font-display text-3xl font-bold mt-1">{me}</div>
          <div className="text-xs text-[var(--muted)] mt-2">聊天时别人只能看到这个代号</div>
        </div>
      )}
      <div className="surface rounded-2xl p-5">
        <div className="text-xs text-[var(--muted)] tracking-wide">第一轮主问题</div>
        <div className="font-display text-lg font-semibold mt-1 leading-snug">{question}</div>
      </div>
    </div>
  );
}

function IntermissionPanel({ endsAt, offset }: { endsAt: number | null; offset: number }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center anim-rise">
      <EmptyArt kind="intermission" />
      <div className="space-y-2">
        <div className="font-display text-2xl font-semibold">系统策略调整中</div>
        <p className="text-sm text-[var(--muted)] max-w-xs leading-relaxed">
          已根据第一轮投票结果调整部分玩家的行为模型。第二轮即将开始，请留意谁变安静、谁变主动。
        </p>
      </div>
      <Countdown endsAt={endsAt} offset={offset} />
    </div>
  );
}

function avatarHue(codename: string): string {
  let h = 0;
  for (let i = 0; i < codename.length; i++) h = (h + codename.charCodeAt(i) * 17) % 360;
  return `hsl(${h} 32% 40%)`;
}

function renderMessageText(text: string) {
  const parts = text.split(/(@玩家\d+)/g);
  return parts.map((part, i) =>
    part.startsWith('@玩家') ? (
      <span key={i} className="font-semibold text-[var(--copper)]">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function formatTs(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function ChatPanel({
  state,
  playerId,
  readonly,
  mentionInsert,
  onMentionConsumed,
}: {
  state: PublicState;
  playerId: string;
  readonly: boolean;
  mentionInsert: string | null;
  onMentionConsumed: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [showMention, setShowMention] = useState(false);
  const [showNewTip, setShowNewTip] = useState(false);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [heldId, setHeldId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const prevLen = useRef(state.room.messages.length);
  const { room } = state;
  const round: 1 | 2 = state.phase.startsWith('ROUND2') ? 2 : 1;
  const myUsage = state.usage[playerId];
  const remaining = state.limits.maxMsgsPerRound - (myUsage?.msgs ?? 0);

  useEffect(() => {
    if (!mentionInsert) return;
    setText((t) => (t.includes(`@${mentionInsert}`) ? t : `${t}@${mentionInsert} `.trimStart()));
    onMentionConsumed();
  }, [mentionInsert, onMentionConsumed]);

  const scrollToBottom = useCallback((smooth = true) => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    nearBottom.current = true;
    setShowNewTip(false);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      nearBottom.current = dist < 80;
      if (nearBottom.current) setShowNewTip(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const len = room.messages.length;
    if (len > prevLen.current) {
      const last = room.messages[len - 1];
      if (last && last.mentions.includes(playerId) && last.playerId !== playerId) {
        setFlashIds((s) => new Set(s).add(last.id));
        window.setTimeout(() => {
          setFlashIds((s) => {
            const n = new Set(s);
            n.delete(last.id);
            return n;
          });
        }, 1000);
      }
      if (nearBottom.current) scrollToBottom(true);
      else setShowNewTip(true);
    }
    prevLen.current = len;
  }, [room.messages, playerId, scrollToBottom]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    const res = await emitAck('chat:send', { text: t });
    if (res.ok) {
      setText('');
      setError('');
      nearBottom.current = true;
      requestAnimationFrame(() => scrollToBottom(true));
    } else {
      setError(res.error ?? '发送失败');
    }
  };

  const mentionTargets = useMemo(
    () => room.players.filter((p) => p.id !== playerId && p.codename),
    [room.players, playerId],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 [scrollbar-gutter:stable]">
        {room.messages.length === 0 && (
          <div className="text-center py-12 space-y-3">
            <EmptyArt kind="chat" />
            <div className="text-xs text-[var(--muted)] tracking-wide">等待发言信号…</div>
          </div>
        )}
        {room.messages.map((m) => {
          const mine = m.playerId === playerId;
          const mentionsMe = m.mentions.includes(playerId);
          if (m.system) {
            return (
              <div key={m.id} className="text-center msg-enter">
                <span className="inline-block text-xs text-[var(--warn)] bg-[rgba(230,192,123,0.1)] border border-[rgba(230,192,123,0.28)] rounded-full px-3.5 py-1.5 leading-relaxed max-w-[92%]">
                  {m.text}
                </span>
              </div>
            );
          }
          return (
            <div key={m.id} className={`flex gap-2 msg-enter group ${mine ? 'justify-end' : 'justify-start'}`}>
              {!mine && (
                <button
                  type="button"
                  disabled={readonly}
                  onClick={() => {
                    if (!readonly) setText((t) => `${t}@${m.codename} `.trimStart());
                  }}
                  className="mt-5 h-7 w-7 shrink-0 rounded-full grid place-items-center text-[10px] font-bold text-white/90 disabled:opacity-70"
                  style={{ background: avatarHue(m.codename) }}
                  title={readonly ? m.codename : `点击 @${m.codename}`}
                >
                  {m.codename.replace(/\D/g, '') || '?'}
                </button>
              )}
              <div className={`max-w-[78%] ${mine ? 'text-right' : ''}`}>
                <div className="text-[11px] text-[var(--muted)] px-1.5 mb-1 tracking-wide flex items-center gap-2 justify-end">
                  {!mine && <span className="mr-auto">{m.codename}</span>}
                  {mine && <span>{m.codename}</span>}
                  <span
                    className={`font-mono text-[10px] opacity-0 group-hover:opacity-70 transition ${heldId === m.id ? 'opacity-90' : ''}`}
                  >
                    {formatTs(m.ts)}
                  </span>
                </div>
                <div
                  title={formatTs(m.ts)}
                  onTouchStart={() => setHeldId(m.id)}
                  onTouchEnd={() => setHeldId(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setHeldId(m.id);
                    window.setTimeout(() => setHeldId(null), 1600);
                  }}
                  className={`inline-block rounded-2xl px-3.5 py-2.5 text-sm text-left break-words leading-relaxed ${
                    mine
                      ? `bubble-mine rounded-br-md`
                      : mentionsMe
                        ? `bubble-mention rounded-bl-md ${flashIds.has(m.id) ? 'mention-flash' : ''}`
                        : `bubble-other rounded-bl-md ${flashIds.has(m.id) ? 'mention-flash' : ''}`
                  }`}
                >
                  {renderMessageText(m.text)}
                </div>
                {heldId === m.id && (
                  <div className="text-[10px] font-mono text-[var(--muted)] mt-1 px-1">{formatTs(m.ts)}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showNewTip && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-[88px] left-1/2 -translate-x-1/2 z-10 rounded-full btn-copper px-4 py-1.5 text-xs shadow-lg"
        >
          有新消息 ↓
        </button>
      )}

      {!readonly && (
        <div className="shrink-0 border-t border-[var(--line)] p-3 space-y-2 bg-[rgba(11,14,18,0.88)] backdrop-blur-md">
          <div className="flex items-center justify-between text-[11px] text-[var(--muted)] px-0.5">
            <span>{round === 2 ? '第二轮最多 @ 一人 · 点头像可 @' : '点头像或名单可 @'}</span>
            <span className={remaining <= 1 ? 'text-[var(--warn)]' : ''}>本轮剩余 {remaining} 条</span>
          </div>
          {showMention && (
            <div className="flex flex-wrap gap-2">
              {mentionTargets.map((p) => (
                <button
                  key={p.id}
                  className="chip text-xs rounded-full px-3 py-1.5 hover:border-[rgba(212,165,116,0.4)]"
                  onClick={() => {
                    setText((t) => `${t}@${p.codename} `);
                    setShowMention(false);
                  }}
                >
                  @{p.codename}
                </button>
              ))}
            </div>
          )}
          {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
          <div className="flex gap-2 items-end">
            <button
              className="chip shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold h-[42px]"
              onClick={() => setShowMention((v) => !v)}
            >
              @
            </button>
            <div className="flex-1 relative">
              <input
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 200))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send();
                }}
                maxLength={200}
                placeholder={remaining > 0 ? '输入消息…' : '本轮发言已用完'}
                disabled={remaining <= 0}
                className="field w-full rounded-xl px-3.5 py-2.5 pr-14 text-sm disabled:opacity-50 h-[42px]"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-[var(--muted)]">
                {text.length}/200
              </span>
            </div>
            <button
              onClick={() => void send()}
              disabled={remaining <= 0 || !text.trim()}
              className="btn-primary shrink-0 rounded-xl px-4 py-2.5 text-sm h-[42px]"
            >
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VotePanel({
  state,
  playerId,
  round,
  myVote,
  onVoted,
}: {
  state: PublicState;
  playerId: string;
  round: 1 | 2;
  myVote: Vote | null;
  onVoted: (v: Vote) => void;
}) {
  const maxPick = round === 1 ? 1 : 2;
  const [targetIds, setTargetIds] = useState<string[]>(myVote ? voteTargets(myVote) : []);
  const [reason, setReason] = useState(myVote?.reason ?? '');
  const [error, setError] = useState('');
  const [done, setDone] = useState(!!myVote);
  const [justSaved, setJustSaved] = useState(false);
  const candidates = state.room.players.filter((p) => p.id !== playerId && p.codename);

  const toggle = (id: string) => {
    setTargetIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (maxPick === 1) return [id];
      if (prev.length >= maxPick) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const submit = async () => {
    const res = await emitAck('vote:cast', { targetIds, reason });
    if (res.ok) {
      setDone(true);
      setError('');
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1200);
      onVoted({ voterId: playerId, targetIds, reason, ts: Date.now() });
    } else {
      setError(res.error ?? '投票失败');
    }
  };

  const pickedNames = targetIds
    .map((id) => candidates.find((p) => p.id === id)?.codename ?? '?')
    .join('、');

  return (
    <div
      className={`shrink-0 border-t border-[rgba(212,165,116,0.28)] bg-[rgba(18,23,30,0.95)] backdrop-blur-md p-4 space-y-3 ${justSaved ? 'vote-success' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-display font-semibold">第{round === 1 ? '一' : '二'}轮投票</div>
          <div className="text-xs text-[var(--muted)] mt-0.5">
            你认为谁是 AI？{round === 2 ? '可选 1～2 人' : '选择 1 人'}
          </div>
        </div>
        <div className="text-xs text-[var(--muted)] shrink-0">已投 {state.room.votedCount} 人</div>
      </div>
      {done && (
        <div className="text-sm text-[var(--signal-bright)]">
          {justSaved ? '✓ 投票已提交' : `已投给 ${pickedNames}`}
          <span className="text-[var(--muted)]">（可修改后重新提交）</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {candidates.map((p) => (
          <button
            key={p.id}
            onClick={() => toggle(p.id)}
            className={`text-sm rounded-full px-3.5 py-1.5 transition ${
              targetIds.includes(p.id) ? 'chip-active' : 'chip hover:border-[rgba(212,165,116,0.35)]'
            }`}
          >
            {p.codename}
          </button>
        ))}
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={100}
        placeholder="你的理由（必填，至少一句）"
        className="field w-full rounded-xl px-3.5 py-2.5 text-sm"
      />
      {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
      <button
        onClick={() => void submit()}
        disabled={targetIds.length < 1 || reason.trim().length < 2}
        className="btn-copper w-full rounded-xl py-2.5"
      >
        {done ? '修改投票' : '提交投票'}
      </button>
    </div>
  );
}

function PlayerRecap({ recap }: { recap: RecapReport }) {
  return (
    <div className="space-y-2 text-left">
      <div className="text-xs tracking-widest uppercase text-[var(--copper)]">本局复盘摘要</div>
      {recap.voteCommentary && (
        <p className="text-xs text-[var(--muted)] leading-relaxed">{recap.voteCommentary}</p>
      )}
      {recap.humanLikeAi[0] && (
        <div className="text-xs">
          <span className="text-[var(--copper)]">最像真人的 AI：</span>
          <span className="text-[var(--text)]/90">
            {recap.humanLikeAi[0].codename}「{recap.humanLikeAi[0].text}」
          </span>
        </div>
      )}
      {recap.aiLikeHuman[0] && (
        <div className="text-xs">
          <span className="text-[var(--signal-bright)]">最像 AI 的人类：</span>
          <span className="text-[var(--text)]/90">
            {recap.aiLikeHuman[0].codename}「{recap.aiLikeHuman[0].text}」
          </span>
        </div>
      )}
    </div>
  );
}

function RevealPanel({ state, playerId }: { state: PublicState; playerId: string }) {
  return (
    <div className="shrink-0 border-t border-[rgba(230,192,123,0.28)] bg-[rgba(18,23,30,0.95)] p-4 max-h-[50%] overflow-y-auto space-y-3">
      <div className="font-display font-semibold">揭晓时刻 — 请看大屏幕</div>
      {state.outcome && (
        <div
          className={`rounded-xl px-3 py-2.5 text-sm font-bold text-center border ${
            state.outcome === 'human'
              ? 'bg-[rgba(61,155,143,0.12)] border-[rgba(61,155,143,0.4)] text-[var(--signal-bright)]'
              : 'bg-[rgba(224,122,106,0.12)] border-[rgba(224,122,106,0.4)] text-[var(--danger)]'
          }`}
        >
          {state.outcome === 'human' ? '人类阵营获胜！所有 AI 均被识别' : 'AI 阵营获胜！至少有一个 AI 隐藏成功'}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {state.room.players.map((p) => (
          <div
            key={p.id}
            className={`rounded-xl border p-3 text-center transition ${
              p.revealed
                ? p.isAI
                  ? 'bg-[rgba(224,122,106,0.12)] border-[rgba(224,122,106,0.45)]'
                  : 'bg-[rgba(61,155,143,0.12)] border-[rgba(61,155,143,0.4)]'
                : 'surface'
            }`}
          >
            <div className="font-semibold text-sm">
              {p.codename}
              {p.id === playerId && <span className="text-[var(--signal-bright)]">（你）</span>}
            </div>
            {p.revealed ? (
              <div className="mt-1.5 text-xs">
                {p.isAI ? (
                  <span className="text-[var(--danger)] font-bold">是 AI</span>
                ) : (
                  <span className="text-[var(--signal-bright)]">
                    {p.realName}
                    {p.userId && <span className="text-[var(--muted)]">（{p.userId}）</span>}
                  </span>
                )}
              </div>
            ) : (
              <div className="mt-1.5 text-xs text-[var(--muted)]">？？？</div>
            )}
          </div>
        ))}
      </div>
      {state.recap ? (
        <div className="surface rounded-xl p-3">
          <PlayerRecap recap={state.recap} />
        </div>
      ) : (
        <div className="text-xs text-center text-[var(--muted)]">复盘生成中…</div>
      )}
    </div>
  );
}
