import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import type { ChatMessage, Player, RoomId } from '../types.js';

/**
 * 真人聊天语料：每局可保存为一份独立 md，供后续 AI 接话时抽样参考语气。
 * 只保留人类发言（去掉系统消息与 AI），避免强化 AI 味。
 */

const MAX_INJECT_CHARS = 900;
const MAX_SAMPLE_LINES = 40;
const MAX_FILES_SCAN = 30;

export interface CorpusFileMeta {
  roomId: RoomId;
  filename: string;
  savedAt: string;
  humanLines: number;
  bytes: number;
}

function corpusRoot(): string {
  return path.join(config.dataDir, 'chat-corpus');
}

function roomDir(roomId: RoomId): string {
  return path.join(corpusRoot(), roomId);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 从本局消息提取人类短句（供复制 / 落盘） */
export function extractHumanLines(messages: ChatMessage[], players: Player[]): string[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const lines: string[] = [];
  for (const m of messages) {
    if (m.system || !m.text.trim()) continue;
    const sender = byId.get(m.playerId);
    if (!sender || sender.isAI) continue;
    const text = m.text.trim().replace(/\s+/g, ' ');
    if (!text) continue;
    lines.push(`${m.codename}: ${text}`);
  }
  return lines;
}

/** 整场可读文本（含系统与 AI，给「复制」用，方便主持人对账） */
export function formatFullTranscript(messages: ChatMessage[], players: Player[]): string {
  const byId = new Map(players.map((p) => [p.id, p]));
  const out: string[] = [];
  for (const m of messages) {
    if (m.system) {
      out.push(`[系统] ${m.text}`);
      continue;
    }
    const sender = byId.get(m.playerId);
    const tag = sender?.isAI ? 'AI' : '人';
    out.push(`[R${m.round}][${tag}] ${m.codename}: ${m.text}`);
  }
  return out.join('\n');
}

export function saveChatCorpus(
  roomId: RoomId,
  messages: ChatMessage[],
  players: Player[],
): { ok: boolean; error?: string; filename?: string; humanLines?: number; path?: string } {
  const lines = extractHumanLines(messages, players);
  if (lines.length < 2) {
    return { ok: false, error: '人类发言不足，至少需要 2 条才值得保存' };
  }

  const dir = roomDir(roomId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${stamp()}-${randomBytes(3).toString('hex')}.md`;
  const filePath = path.join(dir, filename);
  const body = [
    `# 真人聊天语料 · ${roomId}`,
    ``,
    `- savedAt: ${new Date().toISOString()}`,
    `- humanLines: ${lines.length}`,
    `- note: 仅人类发言；供 AI 参考语气，禁止照抄整句`,
    ``,
    `## 发言`,
    ``,
    ...lines.map((l) => `- ${l}`),
    ``,
  ].join('\n');

  fs.writeFileSync(filePath, body, 'utf8');
  console.log(`[corpus] 已保存 ${filePath}（${lines.length} 条人类发言）`);
  return { ok: true, filename, humanLines: lines.length, path: filePath };
}

function parseHumanLinesFromFile(content: string): string[] {
  const lines: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const m = raw.match(/^\s*-\s+(.+)$/);
    if (!m) continue;
    const line = m[1].trim();
    if (!line || line.startsWith('savedAt') || line.startsWith('humanLines') || line.startsWith('note')) continue;
    // 去掉 "玩家01: " 前缀，只留说话内容更利于学语气；保留也可
    const spoken = line.includes(':') ? line.slice(line.indexOf(':') + 1).trim() : line;
    if (spoken) lines.push(spoken);
  }
  return lines;
}

export function listChatCorpus(roomId?: RoomId): CorpusFileMeta[] {
  const rooms: RoomId[] = roomId ? [roomId] : ['food', 'travel'];
  const out: CorpusFileMeta[] = [];
  for (const rid of rooms) {
    const dir = roomDir(rid);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const fp = path.join(dir, name);
      try {
        const st = fs.statSync(fp);
        const content = fs.readFileSync(fp, 'utf8');
        const humanLines = parseHumanLinesFromFile(content).length;
        const savedAt =
          content.match(/savedAt:\s*(\S+)/)?.[1] ?? st.mtime.toISOString();
        out.push({
          roomId: rid,
          filename: name,
          savedAt,
          humanLines,
          bytes: st.size,
        });
      } catch {
        /* skip bad file */
      }
    }
  }
  out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return out;
}

export function deleteChatCorpus(roomId: RoomId, filename: string): { ok: boolean; error?: string } {
  const base = path.basename(filename);
  if (base !== filename || !/^[a-zA-Z0-9._-]+\.md$/.test(filename)) {
    return { ok: false, error: '非法文件名' };
  }
  const fp = path.join(roomDir(roomId), base);
  if (!fs.existsSync(fp)) return { ok: false, error: '文件不存在' };
  fs.rmSync(fp);
  return { ok: true };
}

/**
 * 从该房间最近若干语料文件中抽样短句，注入 prompt。
 * 文件不存在则返回空字符串。
 */
export function sampleChatCorpus(roomId: RoomId): string {
  const dir = roomDir(roomId);
  if (!fs.existsSync(dir)) return '';

  let names: string[];
  try {
    names = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.md'))
      .map((n) => ({ n, m: fs.statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, MAX_FILES_SCAN)
      .map((x) => x.n);
  } catch {
    return '';
  }
  if (names.length === 0) return '';

  const pool: string[] = [];
  for (const name of names) {
    try {
      const content = fs.readFileSync(path.join(dir, name), 'utf8');
      pool.push(...parseHumanLinesFromFile(content));
    } catch {
      /* skip */
    }
  }
  if (pool.length === 0) return '';

  // 打乱后取短句优先（更像微信群）
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const picked: string[] = [];
  let chars = 0;
  for (const line of shuffled) {
    if (picked.length >= MAX_SAMPLE_LINES) break;
    if (line.length > 40) continue; // 过长的不像随手打字，跳过
    if (chars + line.length > MAX_INJECT_CHARS) break;
    picked.push(line);
    chars += line.length + 1;
  }
  if (picked.length === 0) {
    // 退而求其次：允许稍长
    for (const line of shuffled.slice(0, 20)) {
      if (chars + line.length > MAX_INJECT_CHARS) break;
      picked.push(line);
      chars += line.length + 1;
    }
  }
  if (picked.length === 0) return '';

  return (
    '\n以下是以往真人局的说话样例（学语气和长短，禁止照抄原句，也不要复述里面的具体经历）：\n---\n' +
    picked.map((l) => `- ${l}`).join('\n') +
    '\n---'
  );
}
