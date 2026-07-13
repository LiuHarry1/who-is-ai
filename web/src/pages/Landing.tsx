import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSocket, emitAck } from '../socket';
import type { RoomId } from '../types';

interface MetaAck {
  ok: boolean;
  activeRoom?: RoomId;
  title?: string;
}

const ROOM_CARD: Record<RoomId, { emoji: string; title: string; desc: string; cls: string }> = {
  tech: {
    emoji: '💻',
    title: '技术聊天室',
    desc: '聊技术相关话题',
    cls: 'bg-sky-600 hover:bg-sky-500 text-sky-100',
  },
  life: {
    emoji: '🌍',
    title: '生活聊天室',
    desc: '聊日常生活话题',
    cls: 'bg-amber-600 hover:bg-amber-500 text-amber-100',
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

  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight">
          Who is <span className="text-emerald-400">AI</span>?
        </h1>
        <p className="mt-2 text-slate-400">人类鉴别测试 · 找出隐藏在你们中间的 AI</p>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-sm">
        {activeRoom === null ? (
          <div className="text-center text-slate-500 py-8">正在获取本局房间…</div>
        ) : (
          <Link
            to={`/room/${activeRoom}`}
            className={`rounded-2xl transition p-5 text-center ${ROOM_CARD[activeRoom].cls}`}
          >
            <div className="text-2xl text-white">
              {ROOM_CARD[activeRoom].emoji} {ROOM_CARD[activeRoom].title}
            </div>
            <div className="text-sm mt-1">{ROOM_CARD[activeRoom].desc}</div>
            <div className="text-xs mt-2 opacity-80">点击加入本局游戏</div>
          </Link>
        )}
        <Link to="/host" className="text-center text-slate-500 text-sm hover:text-slate-300 mt-2">
          主持人入口
        </Link>
      </div>
    </div>
  );
}
