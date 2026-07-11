import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 3000),
  /** OpenAI 兼容代理地址，tech.md 提供的是 http://localhost:4141 */
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'http://localhost:4141/v1',
  openaiApiKey: process.env.OPENAI_API_KEY || 'dummy',
  // 实测可用模型：claude-opus-4.6 / claude-sonnet-4.6 / gpt-4.1
  // 注意：gpt-5.5 只支持 responses API，不能走 /chat/completions
  modelPrimary: process.env.MODEL_PRIMARY || 'claude-opus-4.6',
  modelFallback: process.env.MODEL_FALLBACK || 'gpt-4.1',
  hostKey: process.env.HOST_KEY || 'whoisai',
  dataDir: process.env.DATA_DIR || './data',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 8000),
};
