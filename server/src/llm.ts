import OpenAI from 'openai';
import { config } from './config.js';

const client = new OpenAI({
  baseURL: config.openaiBaseUrl,
  apiKey: config.openaiApiKey,
});

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function tryModel(model: string, messages: LlmMessage[], maxTokens: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);
  try {
    const res = await client.chat.completions.create(
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
 */
export async function chatComplete(messages: LlmMessage[], maxTokens = 200): Promise<string> {
  try {
    return await tryModel(config.modelPrimary, messages, maxTokens);
  } catch (err) {
    console.warn(`[llm] primary model failed (${(err as Error).message}), falling back to ${config.modelFallback}`);
    return await tryModel(config.modelFallback, messages, maxTokens);
  }
}
