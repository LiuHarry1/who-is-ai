// 管理接口联调：在线编辑主问题/素材/人格卡/prompt 并验证生效
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

// 未认证被拒
const noAuth = await ack(host, 'admin:get', {});
check('未认证 admin:get 被拒', !noAuth.ok);

await ack(host, 'host:auth', { key: 'whoisai' });
const g = await ack(host, 'admin:get', {});
check('admin:get 返回配置', g.ok && g.data.config.personas.tech.length === 3 && typeof g.data.config.prompts.baseRules === 'string');
check('admin:get 返回素材', typeof g.data.domainNotes.tech === 'string');

// 改主问题
const q = await ack(host, 'admin:save', { section: 'mainQuestions', data: { tech: '你最近在调的最烦的一个 case 是什么？' } });
check('保存主问题', q.ok && q.data.config.mainQuestions.tech.includes('最烦的'));
const hs = await ack(host, 'host:auth', { key: 'whoisai' });
check('主问题已应用到房间', hs.state.rooms.find((r) => r.id === 'tech').mainQuestion.includes('最烦的'));

// 改素材
const n = await ack(host, 'admin:save', { section: 'domainNotes', data: { tech: '## 行话\n- 在线编辑测试XYZ' } });
check('保存素材并回读', n.ok && n.data.domainNotes.tech.includes('在线编辑测试XYZ'));

// 改人格卡
const newPersonas = { tech: [{ name: '测试卡', background: '在线编辑的人格', style: '简短' }] };
const p = await ack(host, 'admin:save', { section: 'personas', data: newPersonas });
check('保存人格卡', p.ok && p.data.config.personas.tech.length === 1 && p.data.config.personas.tech[0].name === '测试卡');
check('生活房人格卡未受影响', p.data.config.personas.life.length === 3);
const bad = await ack(host, 'admin:save', { section: 'personas', data: { tech: [] } });
check('空人格卡列表被拒绝', !bad.ok);

// 改 prompt
const pr = await ack(host, 'admin:save', { section: 'prompts', data: { strategyHigh: '高怀疑时装死ONLINE_EDIT' } });
check('保存 prompt', pr.ok && pr.data.config.prompts.strategyHigh.includes('ONLINE_EDIT'));

// 新增 AI 应使用新人格卡
await ack(host, 'host:action', { type: 'removeAI', roomId: 'tech' });
await ack(host, 'host:action', { type: 'addAI', roomId: 'tech' });
const hs2 = await ack(host, 'host:auth', { key: 'whoisai' });
const techAI = hs2.state.rooms.find((r) => r.id === 'tech').players.filter((x) => x.isAI);
check('重加的 AI 使用新人格卡', techAI.length === 1 && techAI[0].realName === 'AI·测试卡', techAI.map((a) => a.realName).join(','));

// 恢复默认
const rst = await ack(host, 'admin:save', { section: 'resetDefaults' });
check('恢复默认值', rst.ok && rst.data.config.personas.tech.length === 3 && !rst.data.config.prompts.strategyHigh.includes('ONLINE_EDIT'));

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed ? 1 : 0);
