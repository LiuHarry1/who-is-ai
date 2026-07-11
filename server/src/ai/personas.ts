import type { Persona, RoomId } from '../types.js';
import { getAiConfig } from './aiConfig.js';

/** 按房间取一个还没用过的人格卡（人格卡内容可在主持人控制台编辑） */
export function pickPersona(roomId: RoomId, used: string[]): Persona {
  const pool = getAiConfig().personas[roomId] ?? [];
  if (pool.length === 0) {
    return { name: '路人', background: '普通同事', style: '话不多，随和' };
  }
  const available = pool.filter((p) => !used.includes(p.name));
  const source = available.length > 0 ? available : pool;
  return structuredClone(source[Math.floor(Math.random() * source.length)]);
}
