/** LLM 不可用时的兜底回复，保证 AI 永不卡死冷场 */

const GENERIC: string[] = [
  '哈哈确实',
  '我也遇到过类似的',
  '这个我得想想',
  '有道理',
  '哈哈哈笑死',
  '真的假的',
  '同感+1',
  '你这么一说还真是',
];

const MENTIONED: string[] = [
  '让我想想怎么说',
  '这个问题有点大，简单说就是还行吧哈哈',
  '一下子问住我了，容我组织下语言',
  '哈哈你这问题够直接的，还真没仔细想过',
];

const VOTE_REASONS: string[] = [
  '说话有点太规整了，像背稿子',
  '回复的节奏有点奇怪',
  '细节说得太顺了，不太像临场想的',
  '感觉回答都在绕，没什么真实细节',
  '直觉，说不上来但就是觉得不对劲',
];

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const fallback = {
  generic: () => pick(GENERIC),
  mentioned: () => pick(MENTIONED),
  voteReason: () => pick(VOTE_REASONS),
};
