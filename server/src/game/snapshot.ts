import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { GameState } from '../types.js';
import type { GameEngine } from './engine.js';

const FILE = path.join(config.dataDir, 'game-state.json');

/** 每次状态变更 debounce 落盘，进程崩溃/重启后可恢复，赛后也可用于复盘 */
export function attachSnapshot(engine: GameEngine) {
  fs.mkdirSync(config.dataDir, { recursive: true });

  let timer: NodeJS.Timeout | null = null;
  engine.on('change', () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        fs.writeFileSync(FILE, JSON.stringify(engine.state, null, 2));
      } catch (err) {
        console.error('[snapshot] write failed:', err);
      }
    }, 500);
  });
}

export function loadSnapshot(): GameState | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as GameState;
  } catch (err) {
    console.error('[snapshot] load failed:', err);
    return null;
  }
}
