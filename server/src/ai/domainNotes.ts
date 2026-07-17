import fs from 'node:fs';
import path from 'node:path';

/**
 * 领域素材包：赛前用 coding agent / 人工准备的行话速查表和战例，
 * 放在 domain-notes/<roomId>.md（如 domain-notes/food.md），启动时加载注入 prompt。
 * 文件不存在则跳过，不是必需品；也可在主持人控制台在线编辑。
 */

const NOTES_DIR = process.env.DOMAIN_NOTES_DIR || './domain-notes';
const MAX_CHARS = 2500; // 控制 token 开销

const cache = new Map<string, string>();

function fileOf(roomId: string): string {
  return path.resolve(NOTES_DIR, `${roomId}.md`);
}

export function domainNotes(roomId: string): string {
  const cached = cache.get(roomId);
  if (cached !== undefined) return cached;

  let notes = '';
  try {
    const file = fileOf(roomId);
    if (fs.existsSync(file)) {
      notes = fs.readFileSync(file, 'utf8').trim();
      if (notes.length > MAX_CHARS) notes = notes.slice(0, MAX_CHARS);
      if (notes) console.log(`[ai] 已加载领域素材 ${file}（${notes.length} 字符）`);
    }
  } catch (err) {
    console.warn(`[ai] 领域素材加载失败（忽略）:`, (err as Error).message);
  }
  cache.set(roomId, notes);
  return notes;
}

/** 主持人控制台在线编辑：写回文件并更新缓存，立即生效 */
export function setDomainNotes(roomId: string, content: string) {
  const trimmed = content.trim().slice(0, MAX_CHARS * 2);
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  fs.writeFileSync(fileOf(roomId), trimmed);
  cache.set(roomId, trimmed.slice(0, MAX_CHARS));
}
