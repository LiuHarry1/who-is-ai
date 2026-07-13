import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSocket, emitAck } from '../socket';
import Countdown from '../components/Countdown';
import { PHASE_LABEL, type PublicState, type RoomId, type Vote } from '../types';

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

  // ---------- 连接与重连 ----------

  const tryJoin = useCallback(
    async (name?: string) => {
      const token = localStorage.getItem(TOKEN_KEY) ?? undefined;
      const res = await emitAck<JoinAck>('join', { roomId, name, token: name ? undefined : token });
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
        // token 失效（如服务器重置），回到报名表单
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

// ---------- 报名 ----------

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
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center">
          加入聊天室 <span className="text-emerald-400">Who is AI?</span>
        </h1>
        <p className="text-slate-400 text-sm text-center">
          输入你的真实姓名（仅主持人可见），进入后系统会分配匿名代号。
        </p>
        {pending ? (
          <div className="text-center text-slate-500">连接中…</div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) onJoin(name.trim());
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="你的姓名"
              className="w-full rounded-xl bg-slate-800 border border-slate-700 px-4 py-3 outline-none focus:border-emerald-500"
            />
            {error && <div className="text-red-400 text-sm">{error}</div>}
            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 transition py-3 font-bold"
            >
              进入房间
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------- 游戏主界面 ----------

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

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto">
      {/* 头部 */}
      <header className="shrink-0 px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
        <div>
          <div className="font-bold">{room.title}</div>
          <div className="text-xs text-slate-400">
            {PHASE_LABEL[phase]}
            {me?.codename && <span className="ml-2 text-emerald-400">你是 {me.codename}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!connected && <span className="text-xs text-red-400">重连中…</span>}
          <Countdown endsAt={state.phaseEndsAt} offset={offset} />
        </div>
      </header>

      {/* 主体 */}
      {phase === 'LOBBY' && <Lobby count={room.playerCount} />}
      {phase === 'RULES' && <Rules me={me?.codename ?? ''} question={room.mainQuestion} />}
      {(isChat || isVote || phase === 'INTERMISSION' || phase === 'REVEAL') && (
        <ChatPanel state={state} playerId={playerId} readonly={!isChat} />
      )}

      {/* 底部：投票面板 */}
      {isVote && (
        <VotePanel
          state={state}
          playerId={playerId}
          round={round}
          myVote={round === 1 ? myVotes.r1 : myVotes.r2}
          onVoted={(v) => setMyVotes((prev) => (round === 1 ? { ...prev, r1: v } : { ...prev, r2: v }))}
        />
      )}
      {phase === 'REVEAL' && <RevealPanel state={state} playerId={playerId} />}
    </div>
  );
}

function Lobby({ count }: { count: number }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-6xl">🕵️</div>
      <div className="text-xl font-bold">已加入！等待游戏开始…</div>
      <div className="text-slate-400">
        当前房间人数：<span className="text-emerald-400 font-bold">{count}</span>
      </div>
      <p className="text-sm text-slate-500 max-w-xs">
        游戏开始后每个人会获得一个匿名代号，你们中间至少隐藏着一个 AI。
      </p>
    </div>
  );
}

function Rules({ me, question }: { me: string; question: string }) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
        <h2 className="font-bold text-lg">游戏规则</h2>
        <ul className="text-sm text-slate-300 space-y-2 list-disc pl-5">
          <li>房间里至少混入了 1 个 AI，你的任务是找出它</li>
          <li>两轮聊天 + 两轮投票，第二轮投票决定胜负</li>
          <li>每轮每人最多发言 5 条，第一轮每人至少发言一次</li>
          <li>第二轮每人最多 @ 一人提问</li>
          <li>第一轮投票会影响 AI 的行为，注意观察变化</li>
        </ul>
      </div>
      {me && (
        <div className="rounded-2xl bg-emerald-950/50 border border-emerald-800 p-5 text-center">
          <div className="text-sm text-emerald-300">你的匿名代号</div>
          <div className="text-3xl font-black mt-1">{me}</div>
          <div className="text-xs text-slate-400 mt-2">聊天时别人只能看到这个代号</div>
        </div>
      )}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
        <div className="text-sm text-slate-400">第一轮主问题（提前想想怎么答）</div>
        <div className="font-bold mt-1">{question}</div>
      </div>
    </div>
  );
}

// ---------- 聊天 ----------

function ChatPanel({
  state,
  playerId,
  readonly,
}: {
  state: PublicState;
  playerId: string;
  readonly: boolean;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [showMention, setShowMention] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const { room } = state;
  const round: 1 | 2 = state.phase.startsWith('ROUND2') ? 2 : 1;
  const myUsage = state.usage[playerId];
  const remaining = state.limits.maxMsgsPerRound - (myUsage?.msgs ?? 0);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [room.messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    const res = await emitAck('chat:send', { text: t });
    if (res.ok) {
      setText('');
      setError('');
    } else {
      setError(res.error ?? '发送失败');
    }
  };

  const mentionTargets = useMemo(
    () => room.players.filter((p) => p.id !== playerId && p.codename),
    [room.players, playerId],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 [scrollbar-gutter:stable]">
        {room.messages.map((m) => {
          const mine = m.playerId === playerId;
          const mentionsMe = m.mentions.includes(playerId);
          if (m.system) {
            return (
              <div key={m.id} className="text-center">
                <span className="inline-block text-xs text-amber-300 bg-amber-950/50 border border-amber-900 rounded-full px-3 py-1">
                  📢 {m.text}
                </span>
              </div>
            );
          }
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${mine ? 'text-right' : ''}`}>
                <div className="text-xs text-slate-500 px-1">{m.codename}</div>
                <div
                  className={`inline-block rounded-2xl px-3 py-2 text-sm text-left break-words ${
                    mine
                      ? 'bg-emerald-700'
                      : mentionsMe
                        ? 'bg-indigo-900 border border-indigo-600'
                        : 'bg-slate-800'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!readonly && (
        <div className="shrink-0 border-t border-slate-800 p-3 space-y-2">
          {showMention && (
            <div className="flex flex-wrap gap-2">
              {mentionTargets.map((p) => (
                <button
                  key={p.id}
                  className="text-xs rounded-full bg-slate-800 hover:bg-slate-700 px-3 py-1"
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
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2 items-center">
            <button
              className="shrink-0 rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-sm"
              onClick={() => setShowMention((v) => !v)}
              title={round === 2 ? '第二轮最多 @ 一人' : '@ 某人'}
            >
              @
            </button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send();
              }}
              maxLength={200}
              placeholder={remaining > 0 ? `发言（本轮还剩 ${remaining} 条）` : '本轮发言已用完'}
              disabled={remaining <= 0}
              className="flex-1 rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
            />
            <button
              onClick={() => void send()}
              disabled={remaining <= 0 || !text.trim()}
              className="shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-4 py-2 text-sm font-bold"
            >
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 投票 ----------

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
  const [targetId, setTargetId] = useState(myVote?.targetId ?? '');
  const [reason, setReason] = useState(myVote?.reason ?? '');
  const [error, setError] = useState('');
  const [done, setDone] = useState(!!myVote);
  const candidates = state.room.players.filter((p) => p.id !== playerId && p.codename);

  const submit = async () => {
    const res = await emitAck('vote:cast', { targetId, reason });
    if (res.ok) {
      setDone(true);
      setError('');
      onVoted({ voterId: playerId, targetId, reason, ts: Date.now() });
    } else {
      setError(res.error ?? '投票失败');
    }
  };

  return (
    <div className="shrink-0 border-t-2 border-indigo-800 bg-slate-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-bold">🗳️ 第{round === 1 ? '一' : '二'}轮投票：你认为谁是 AI？</div>
        <div className="text-xs text-slate-400">已投 {state.room.votedCount} 人</div>
      </div>
      {done && (
        <div className="text-sm text-emerald-400">
          已投给 {candidates.find((p) => p.id === targetId)?.codename ?? '?'}（可修改后重新提交）
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {candidates.map((p) => (
          <button
            key={p.id}
            onClick={() => setTargetId(p.id)}
            className={`text-sm rounded-full px-3 py-1.5 border transition ${
              targetId === p.id
                ? 'bg-indigo-600 border-indigo-400 font-bold'
                : 'bg-slate-800 border-slate-700 hover:border-slate-500'
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
        className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <button
        onClick={() => void submit()}
        disabled={!targetId || reason.trim().length < 2}
        className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 py-2.5 font-bold"
      >
        {done ? '修改投票' : '提交投票'}
      </button>
    </div>
  );
}

// ---------- 揭晓 ----------

function RevealPanel({ state, playerId }: { state: PublicState; playerId: string }) {
  return (
    <div className="shrink-0 border-t-2 border-amber-800 bg-slate-900 p-4 max-h-[45%] overflow-y-auto">
      <div className="font-bold mb-3">🎬 揭晓时刻 — 关注大屏幕！</div>
      <div className="grid grid-cols-2 gap-2">
        {state.room.players.map((p) => (
          <div
            key={p.id}
            className={`rounded-xl border p-3 text-center transition ${
              p.revealed
                ? p.isAI
                  ? 'bg-red-950/60 border-red-700'
                  : 'bg-emerald-950/60 border-emerald-800'
                : 'bg-slate-800 border-slate-700'
            }`}
          >
            <div className="font-bold text-sm">
              {p.codename}
              {p.id === playerId && <span className="text-emerald-400">（你）</span>}
            </div>
            {p.revealed ? (
              <div className="mt-1 text-xs">
                {p.isAI ? (
                  <span className="text-red-400 font-bold">🤖 AI</span>
                ) : (
                  <span className="text-emerald-300">🧑 {p.realName}</span>
                )}
              </div>
            ) : (
              <div className="mt-1 text-xs text-slate-500">？？？</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
