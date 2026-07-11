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
      className={`font-mono text-lg font-bold tabular-nums ${
        urgent ? 'text-red-400 animate-pulse' : 'text-emerald-400'
      }`}
    >
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}
