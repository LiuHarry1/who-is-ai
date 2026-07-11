// 端到端联调脚本：模拟主持人 + 多名玩家跑完整局游戏
import { io } from 'socket.io-client';

const URL = 'http://localhost:3100';
const results = [];
let failed = 0;

function check(name, cond, detail = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
}

function connect() {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
  });
}

function ack(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ---------- 主持人 ----------
  const host = await connect();
  const badAuth = await ack(host, 'host:auth', { key: 'wrong' });
  check('错误口令被拒绝', !badAuth.ok);
  const auth = await ack(host, 'host:auth', { key: 'whoisai' });
  check('主持人认证成功', auth.ok);
  check('默认 AI：技术房1 生活房2', (() => {
    const tech = auth.state.rooms.find((r) => r.id === 'tech');
    const life = auth.state.rooms.find((r) => r.id === 'life');
    return tech.players.filter((p) => p.isAI).length === 1 && life.players.filter((p) => p.isAI).length === 2;
  })());

  let hostState = auth.state;
  host.on('host:state', (s) => (hostState = s));
  const hostAction = (payload) => ack(host, 'host:action', payload);

  // ---------- 玩家加入 ----------
  const players = [];
  for (let i = 0; i < 4; i++) {
    const s = await connect();
    const res = await ack(s, 'join', { roomId: 'tech', name: `技术玩家${i}` });
    check(`技术玩家${i} 加入`, res.ok);
    players.push({ socket: s, ...res, name: `技术玩家${i}` });
    s.on('state', (st) => (players[i].state = st));
  }
  const dupe = await ack(players[0].socket, 'join', { roomId: 'tech', name: '技术玩家0' });
  check('重名被拒绝', !dupe.ok);

  const lifers = [];
  for (let i = 0; i < 3; i++) {
    const s = await connect();
    const res = await ack(s, 'join', { roomId: 'life', name: `生活玩家${i}` });
    check(`生活玩家${i} 加入`, res.ok);
    lifers.push({ socket: s, ...res });
  }

  // LOBBY 阶段禁止聊天
  const earlyMsg = await ack(players[0].socket, 'chat:send', { text: '早了' });
  check('LOBBY 阶段禁止聊天', !earlyMsg.ok);

  // 代号未分配
  check('LOBBY 阶段代号未分配', players[0].state.room.players.every((p) => !p.codename));
  check('公开状态不泄露 AI 身份', players[0].state.room.players.every((p) => p.isAI === null && p.realName === null));

  // ---------- RULES：分配代号 ----------
  await hostAction({ type: 'next' });
  await sleep(400);
  check('进入 RULES', players[0].state.phase === 'RULES');
  const codenames = players[0].state.room.players.map((p) => p.codename);
  check('代号已分配且格式正确', codenames.every((c) => /^玩家\d{2}$/.test(c)), codenames.join(','));
  check('房间人数 = 4人 + 1AI', players[0].state.room.players.length === 5);

  // ---------- ROUND1_CHAT ----------
  await hostAction({ type: 'next' });
  await sleep(400);
  check('进入 ROUND1_CHAT 且有倒计时', players[0].state.phase === 'ROUND1_CHAT' && !!players[0].state.phaseEndsAt);
  check('系统公告主问题', players[0].state.room.messages.some((m) => m.system && m.text.includes('debug')));

  const m1 = await ack(players[0].socket, 'chat:send', { text: '我先来，上次调一个内存泄漏调了三天' });
  check('发言成功', m1.ok);
  const fast = await ack(players[0].socket, 'chat:send', { text: '连发' });
  check('2秒内连发被限流', !fast.ok);

  await sleep(2100);
  // @ 提及 AI，验证"被@必回"
  const techHost = hostState.rooms.find((r) => r.id === 'tech');
  const aiPlayer = techHost.players.find((p) => p.isAI);
  const mention = await ack(players[0].socket, 'chat:send', { text: `@${aiPlayer.codename} 你那次是什么问题？` });
  check('@ 消息发送成功', mention.ok);

  // 玩家1发满配额
  for (let k = 0; k < 6; k++) {
    await sleep(2100);
    const r = await ack(players[1].socket, 'chat:send', { text: `灌水${k}` });
    if (k < 5) check(`玩家1 第${k + 1}条发言`, r.ok);
    else check('第6条发言被配额拦截', !r.ok, r.error);
  }

  // 等 AI 被 @ 后回复（LLM 不可用 → 走 fallback，含超时最多 ~45s）
  let aiReplied = false;
  for (let t = 0; t < 50 && !aiReplied; t++) {
    await sleep(1000);
    aiReplied = players[0].state.room.messages.some((m) => m.playerId === aiPlayer.id);
  }
  check('AI 被 @ 后有回复（fallback 兜底）', aiReplied,
    players[0].state.room.messages.filter((m) => m.playerId === aiPlayer.id).map((m) => m.text).join(' | '));

  // ---------- ROUND1_VOTE ----------
  await hostAction({ type: 'next' });
  await sleep(400);
  check('进入 ROUND1_VOTE', players[0].state.phase === 'ROUND1_VOTE');
  const chatInVote = await ack(players[0].socket, 'chat:send', { text: '投票时说话' });
  check('投票阶段聊天被锁定', !chatInVote.ok);

  const selfVote = await ack(players[0].socket, 'vote:cast', { targetId: players[0].playerId, reason: '我怀疑我自己' });
  check('不能投自己', !selfVote.ok);
  const noReason = await ack(players[0].socket, 'vote:cast', { targetId: aiPlayer.id, reason: '' });
  check('理由必填', !noReason.ok);

  // 所有人类都投 AI（制造高怀疑）
  for (const p of players) {
    const r = await ack(p.socket, 'vote:cast', { targetId: aiPlayer.id, reason: '说话太规整了' });
    check(`${p.name} 投票成功`, r.ok);
  }
  const revote = await ack(players[0].socket, 'vote:cast', { targetId: players[1].playerId, reason: '改投这位' });
  check('允许修改投票', revote.ok);

  // ---------- ROUND2 ----------
  await hostAction({ type: 'next' }); // INTERMISSION
  await hostAction({ type: 'next' }); // ROUND2_CHAT
  await sleep(400);
  check('进入 ROUND2_CHAT', players[0].state.phase === 'ROUND2_CHAT');
  check('系统公告行为调整', players[0].state.room.messages.some((m) => m.system && m.text.includes('行为模型')));

  const p2names = players[0].state.room.players.filter((x) => x.id !== players[0].playerId).map((x) => x.codename);
  const at1 = await ack(players[0].socket, 'chat:send', { text: `@${p2names[0]} 你昨天说的再展开讲讲？` });
  check('第二轮第一次 @ 成功', at1.ok);
  await sleep(2100);
  const at2 = await ack(players[0].socket, 'chat:send', { text: `@${p2names[1]} 你也说说` });
  check('第二轮第二次 @ 被拒绝', !at2.ok, at2.error);
  await sleep(2100);
  const plain = await ack(players[0].socket, 'chat:send', { text: '不@人正常说话没问题' });
  check('用过 @ 后仍可普通发言', plain.ok);

  // ---------- ROUND2_VOTE ----------
  await hostAction({ type: 'next' });
  await sleep(400);
  for (const p of players) {
    await ack(p.socket, 'vote:cast', { targetId: aiPlayer.id, reason: '第二轮突然变安静了' });
  }

  // ---------- 加时 ----------
  const before = players[0].state.phaseEndsAt;
  await hostAction({ type: 'extend', seconds: 60 });
  await sleep(400);
  check('加时 1 分钟生效', players[0].state.phaseEndsAt > before);

  // ---------- REVEAL ----------
  await hostAction({ type: 'next' });
  await sleep(400);
  check('进入 REVEAL', players[0].state.phase === 'REVEAL');

  await hostAction({ type: 'reveal', playerId: aiPlayer.id });
  await sleep(400);
  const revealedAI = players[0].state.room.players.find((p) => p.id === aiPlayer.id);
  check('揭晓后玩家端可见 AI 身份', revealedAI.revealed && revealedAI.isAI === true);
  const unrevealed = players[0].state.room.players.find((p) => p.id !== aiPlayer.id);
  check('未揭晓的仍然保密', unrevealed.isAI === null);

  await hostAction({ type: 'revealAll' });
  await sleep(400);
  check('一键全揭', players[0].state.room.players.every((p) => p.revealed));

  const awards = hostState.awards;
  check('最强侦探有数据且猜中数>0', awards.detectives.length > 0 && awards.detectives[0].score >= 1,
    JSON.stringify(awards.detectives[0]));
  check('最强AI榜单包含AI', awards.ais.length === 3);

  // ---------- 断线重连 ----------
  players[0].socket.disconnect();
  await sleep(300);
  const s2 = await connect();
  const rejoin = await ack(s2, 'join', { token: players[0].token });
  check('token 断线重连成功', rejoin.ok && rejoin.playerId === players[0].playerId);
  check('重连恢复我的投票记录', rejoin.myVotes?.r2?.targetId === aiPlayer.id);

  // ---------- 重置 ----------
  await hostAction({ type: 'reset' });
  await sleep(400);
  check('重置后回到 LOBBY', hostState.phase === 'LOBBY');
  check('重置后重新种入默认 AI', hostState.rooms.flatMap((r) => r.players).filter((p) => p.isAI).length === 3);
  const staleToken = await ack(s2, 'join', { token: players[0].token });
  check('重置后旧 token 失效', !staleToken.ok || !staleToken.playerId);

  console.log('\n===== 测试结果 =====');
  for (const r of results) console.log(r);
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E ERROR:', err);
  process.exit(1);
});
