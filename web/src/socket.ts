import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function emitAck<T = { ok: boolean; error?: string }>(
  event: string,
  payload: unknown,
): Promise<T> {
  return new Promise((resolve) => {
    getSocket().timeout(8000).emit(event, payload, (err: unknown, res: T) => {
      if (err) resolve({ ok: false, error: '请求超时' } as T);
      else resolve(res);
    });
  });
}
