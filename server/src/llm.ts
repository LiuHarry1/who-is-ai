import OpenAI from 'openai';
import { config } from './config.js';
import { getAiConfig } from './ai/aiConfig.js';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// client 随运行时配置（baseUrl/apiKey 可在主持人控制台修改）动态重建
let client: OpenAI | null = null;
let clientKey = '';

function getClient(): OpenAI {
  const { baseUrl, apiKey } = getAiConfig().models;
  const key = `${baseUrl}|${apiKey}`;
  if (!client || clientKey !== key) {
    client = new OpenAI({ baseURL: baseUrl, apiKey });
    clientKey = key;
    modelListCache = null;
  }
  return client;
}

async function tryModel(model: string, messages: LlmMessage[], maxTokens: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);
  try {
    const res = await getClient().chat.completions.create(
      {
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.9,
      },
      { signal: controller.signal },
    );
    const text = res.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('empty completion');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 调用 LLM：主模型失败/超时后降级到备用模型，仍失败则抛错，由调用方走 fallback 回复库。
 * 接入地址、key、模型名均从运行时配置读取（主持人控制台可改）。
 */
export async function chatComplete(messages: LlmMessage[], maxTokens = 200): Promise<string> {
  const { primary, fallback } = getAiConfig().models;
  try {
    return await tryModel(primary, messages, maxTokens);
  } catch (err) {
    console.warn(`[llm] primary model failed (${(err as Error).message}), falling back to ${fallback}`);
    return await tryModel(fallback, messages, maxTokens);
  }
}

// ---------- 模型列表（供设置页下拉框） ----------

let modelListCache: { list: string[]; ts: number } | null = null;

export async function listModels(): Promise<string[]> {
  if (modelListCache && Date.now() - modelListCache.ts < 60_000) return modelListCache.list;
  try {
    const c = getClient();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const page = await c.models.list({ signal: controller.signal });
      const ids = page.data
        .map((m) => m.id)
        .filter((id) => !id.includes('embedding'))
        .sort();
      modelListCache = { list: ids, ts: Date.now() };
      return ids;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn('[llm] 模型列表获取失败:', (err as Error).message);
    return modelListCache?.list ?? [];
  }
}

/** 连通性测试：用当前配置发一次最小对话请求 */
export async function testConnection(): Promise<{ ok: boolean; error?: string; reply?: string }> {
  try {
    const reply = await tryModel(getAiConfig().models.primary, [{ role: 'user', content: '回复"ok"两个字母' }], 10);
    return { ok: true, reply };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
