const KEY = 'whoisai_sound';

export function isSoundEnabled(): boolean {
  return localStorage.getItem(KEY) === '1';
}

export function setSoundEnabled(on: boolean) {
  localStorage.setItem(KEY, on ? '1' : '0');
}

/** 轻量提示音（无需音频文件）；默认关闭 */
export function playCue(kind: 'message' | 'phase' | 'mention' | 'vote' = 'message') {
  if (!isSoundEnabled()) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    const freqs = { message: 660, phase: 520, mention: 880, vote: 740 } as const;
    o.frequency.value = freqs[kind];
    o.type = kind === 'phase' ? 'triangle' : 'sine';
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.start(now);
    o.stop(now + 0.2);
    o.onended = () => void ctx.close();
  } catch {
    /* ignore */
  }
}

export function vibrateShort() {
  try {
    navigator.vibrate?.(28);
  } catch {
    /* ignore */
  }
}
