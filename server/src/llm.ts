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

/** 这些模型在不少代理上只开 Responses，不开 chat/completions */
function prefersResponsesApi(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('gpt-5') || m.startsWith('o3') || m.startsWith('o4');
}

function isUnsupportedChatEndpoint(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return (
    msg.includes('unsupported_api_for_model') ||
    msg.includes('not accessible via the /chat/completions') ||
    msg.includes('not supported by the Chat Completions')
  );
}

async function tryChatCompletions(
  model: string,
  messages: LlmMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

/** OpenAI Responses API（/v1/responses），供 gpt-5.5 等模型使用 */
async function tryResponsesApi(
  model: string,
  messages: LlmMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const instructions = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
      .trim();
    const input = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const res = await getClient().responses.create(
      {
        model,
        instructions: instructions || undefined,
        input: input.length === 1 && input[0].role === 'user' ? input[0].content : input,
        max_output_tokens: maxTokens,
        temperature: 0.9,
        store: false,
      },
      { signal: controller.signal },
    );

    const text = (res.output_text ?? '').trim();
    if (text) return text;

    // SDK 未填 output_text 时，从 output 里抠
    for (const item of res.output ?? []) {
      if (item.type !== 'message') continue;
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && part.text?.trim()) return part.text.trim();
      }
    }
    throw new Error('empty responses output');
  } finally {
    clearTimeout(timer);
  }
}

async function tryModel(
  model: string,
  messages: LlmMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  if (prefersResponsesApi(model)) {
    try {
      return await tryResponsesApi(model, messages, maxTokens, timeoutMs);
    } catch (err) {
      console.warn(
        `[llm] responses API failed for ${model} (${(err as Error).message}), trying chat/completions`,
      );
      return await tryChatCompletions(model, messages, maxTokens, timeoutMs);
    }
  }

  try {
    return await tryChatCompletions(model, messages, maxTokens, timeoutMs);
  } catch (err) {
    if (!isUnsupportedChatEndpoint(err)) throw err;
    console.warn(`[llm] ${model} 不支持 chat/completions，改走 responses API`);
    return await tryResponsesApi(model, messages, maxTokens, timeoutMs);
  }
}

/**
 * 调用 LLM。
 * - 普通模型：OpenAI 兼容 /chat/completions
 * - gpt-5.x 等：优先 /responses，失败再试 chat/completions
 * - 指定模型失败后降级全局 fallback
 */
export async function chatComplete(
  messages: LlmMessage[],
  maxTokens = 200,
  model?: string,
  timeoutMs = config.llmTimeoutMs,
): Promise<string> {
  const { primary, fallback } = getAiConfig().models;
  const preferred = (model || primary).trim() || primary;
  try {
    return await tryModel(preferred, messages, maxTokens, timeoutMs);
  } catch (err) {
    if (preferred === fallback) throw err;
    console.warn(
      `[llm] model ${preferred} failed (${(err as Error).message}), falling back to ${fallback}`,
    );
    return await tryModel(fallback, messages, maxTokens, timeoutMs);
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
    const reply = await tryModel(
      getAiConfig().models.primary,
      [{ role: 'user', content: '回复"ok"两个字母' }],
      10,
      config.llmTimeoutMs,
    );
    return { ok: true, reply };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
