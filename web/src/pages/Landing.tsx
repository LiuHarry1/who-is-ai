import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSocket, emitAck } from '../socket';
import { ROOM_LABEL, type RoomId } from '../types';

interface MetaAck {
  ok: boolean;
  activeRoom?: RoomId;
  title?: string;
}

const ROOM_META: Record<RoomId, { desc: string; accent: string }> = {
  food: {
    desc: '围绕美食、餐厅、踩坑与推荐自由聊天',
    accent: 'from-[#c47a4a]/20 to-transparent',
  },
  travel: {
    desc: '围绕旅行、假期、目的地与经历自由聊天',
    accent: 'from-[#3d9b8f]/20 to-transparent',
  },
};

export default function Landing() {
  const [activeRoom, setActiveRoom] = useState<RoomId | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const fetchMeta = async () => {
      const res = await emitAck<MetaAck>('meta:get', {});
      if (res.ok && res.activeRoom) setActiveRoom(res.activeRoom);
    };
    socket.on('connect', fetchMeta);
    if (socket.connected) void fetchMeta();
    return () => {
      socket.off('connect', fetchMeta);
    };
  }, []);

  const meta = activeRoom ? ROOM_META[activeRoom] : null;
  const label = activeRoom ? ROOM_LABEL[activeRoom] : null;

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-12 relative overflow-hidden">
      <div className="w-full max-w-md text-center space-y-8">
        <div className="anim-rise space-y-4">
          <div className="inline-flex items-center gap-2 text-[11px] tracking-[0.22em] uppercase text-[var(--muted)]">
            <span className="signal-dot inline-block h-1.5 w-1.5 rounded-full bg-[var(--signal)]" />
            Identity Signal Test
          </div>
          <h1 className="font-display text-5xl sm:text-6xl font-bold tracking-tight leading-none">
            Who is{' '}
            <span className="bg-gradient-to-r from-[var(--signal-bright)] to-[var(--copper)] bg-clip-text text-transparent">
              AI
            </span>
            ?
          </h1>
          <p className="text-[var(--muted)] text-sm sm:text-base leading-relaxed max-w-sm mx-auto">
            两轮聊天，两轮投票。找出隐藏在你们中间的 AI。
          </p>
        </div>

        <div className="anim-rise-delay-1">
          {!activeRoom || !meta || !label ? (
            <div className="surface rounded-2xl px-5 py-10 text-[var(--muted)] text-sm">正在连接本局房间…</div>
          ) : (
            <Link
              to={`/room/${activeRoom}`}
              className={`group relative block overflow-hidden rounded-2xl surface p-6 text-left transition hover:border-[rgba(212,165,116,0.35)]`}
            >
              <div
                className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${meta.accent} opacity-80`}
              />
              <div className="relative">
                <div className="text-xs tracking-widest uppercase text-[var(--copper)] mb-2">本局房间</div>
                <div className="font-display text-2xl font-semibold">
                  {label.emoji} {label.title}
                </div>
                <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">{meta.desc}</p>
                <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--signal-bright)] group-hover:gap-3 transition-all">
                  进入游戏
                  <span aria-hidden>→</span>
                </div>
              </div>
            </Link>
          )}
        </div>

        <div className="anim-rise-delay-2 flex flex-col items-center gap-3">
          <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] tracking-wide">
            <span>两轮推理</span>
            <span className="opacity-40">·</span>
            <span>动态 AI</span>
            <span className="opacity-40">·</span>
            <span>阵营胜负</span>
          </div>
          <Link
            to="/host"
            className="text-xs text-[var(--muted)] hover:text-[var(--copper)] transition tracking-wide"
          >
            主持人入口
          </Link>
        </div>
      </div>
    </div>
  );
}
