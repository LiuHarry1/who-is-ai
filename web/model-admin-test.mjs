// LLM 接入配置在线编辑联调
import { io } from 'socket.io-client';

const URL = 'http://localhost:3101';
let failed = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
};
const connect = () => new Promise((r) => { const s = io(URL, { transports: ['websocket'] }); s.on('connect', () => r(s)); });
const ack = (s, e, p) => new Promise((r) => s.emit(e, p, r));

const host = await connect();
await ack(host, 'host:auth', { key: 'whoisai' });

// 初始配置
const g = await ack(host, 'admin:get', {});
check('返回模型配置', g.ok && g.data.config.models.primary === 'claude-opus-4.6');
check('返回 baseUrl/apiKey', g.data.config.models.baseUrl.includes('4141') && typeof g.data.config.models.apiKey === 'string');
check('模型列表已拉取', Array.isArray(g.data.modelList) && g.data.modelList.length > 0, `${g.data.modelList.length} 个`);
check('模型列表含 claude-opus-4.6', g.data.modelList.includes('claude-opus-4.6'));

// 测试连接（当前配置）
const t1 = await ack(host, 'admin:testLLM', {});
check('测试连接成功', t1.ok, t1.reply ?? t1.error);

// 切换模型
const s1 = await ack(host, 'admin:save', { section: 'models', data: { primary: 'claude-sonnet-4.6' } });
check('切换主模型', s1.ok && s1.data.config.models.primary === 'claude-sonnet-4.6');
check('其他字段保留', s1.data.config.models.fallback === 'gpt-4.1' && s1.data.config.models.baseUrl.includes('4141'));

const t2 = await ack(host, 'admin:testLLM', {});
check('新模型连接正常', t2.ok, t2.reply ?? t2.error);

// 改成一个坏的 baseUrl，测试连接应失败但不崩
const s2 = await ack(host, 'admin:save', { section: 'models', data: { baseUrl: 'http://localhost:9/v1' } });
check('保存坏地址成功（保存本身不校验连通）', s2.ok);
const t3 = await ack(host, 'admin:testLLM', {});
check('坏地址测试连接返回失败而非崩溃', !t3.ok, t3.error?.slice(0, 60));

// 恢复默认
const rst = await ack(host, 'admin:save', { section: 'resetDefaults' });
check('恢复默认后模型配置还原', rst.ok && rst.data.config.models.primary === 'claude-opus-4.6' && rst.data.config.models.baseUrl.includes('4141'));
const t4 = await ack(host, 'admin:testLLM', {});
check('恢复默认后连接正常', t4.ok, t4.reply ?? t4.error);

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed ? 1 : 0);
