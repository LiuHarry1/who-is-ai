import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight">
          Who is <span className="text-emerald-400">AI</span>?
        </h1>
        <p className="mt-2 text-slate-400">人类鉴别测试 · 找出隐藏在你们中间的 AI</p>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-sm">
        <Link
          to="/room/tech"
          className="rounded-2xl bg-sky-600 hover:bg-sky-500 transition p-5 text-center"
        >
          <div className="text-2xl">💻 技术聊天室</div>
          <div className="text-sky-200 text-sm mt-1">聊技术相关话题</div>
        </Link>
        <Link
          to="/room/life"
          className="rounded-2xl bg-amber-600 hover:bg-amber-500 transition p-5 text-center"
        >
          <div className="text-2xl">🌍 生活聊天室</div>
          <div className="text-amber-100 text-sm mt-1">聊日常生活话题</div>
        </Link>
        <Link to="/host" className="text-center text-slate-500 text-sm hover:text-slate-300 mt-2">
          主持人入口
        </Link>
      </div>
    </div>
  );
}
