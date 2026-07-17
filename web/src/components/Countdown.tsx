import { useEffect, useState } from 'react';

interface Props {
  endsAt: number | null;
  /** 服务器时间与本地时间的偏移（serverNow - localNow） */
  offset: number;
}

export default function Countdown({ endsAt, offset }: Props) {
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  if (!endsAt) return null;
  const remain = Math.max(0, endsAt - (Date.now() + offset));
  const total = Math.ceil(remain / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const urgent = total <= 30;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-base font-bold tabular-nums border ${
        urgent
          ? 'text-[var(--danger)] border-[rgba(224,122,106,0.45)] bg-[rgba(224,122,106,0.1)] animate-pulse'
          : 'text-[var(--signal-bright)] border-[rgba(61,155,143,0.35)] bg-[rgba(61,155,143,0.1)]'
      }`}
    >
      <span className="text-[10px] font-sans font-medium tracking-wider opacity-70">TIME</span>
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}
