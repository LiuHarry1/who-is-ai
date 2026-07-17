const USERID_KEY = 'whoisai_userid';

/**
 * 从 URL 中取真实用户 ID（?userid=jeffery.zhao）。
 * 兼容两种写法（应用用的是 hash 路由）：
 *   http://host/?userid=jeffery.zhao#/room/food   —— query 在 # 之前
 *   http://host/#/room/food?userid=jeffery.zhao   —— query 在 hash 内部
 * 取到后写入 localStorage，之后页面内跳转丢了参数也能拿到。
 */
export function getUserId(): string {
  const fromUrl = readFromUrl();
  if (fromUrl) {
    localStorage.setItem(USERID_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(USERID_KEY) ?? '';
}

function readFromUrl(): string {
  const search = new URLSearchParams(window.location.search);
  const v = search.get('userid') ?? search.get('userId');
  if (v?.trim()) return v.trim();

  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx >= 0) {
    const hashParams = new URLSearchParams(hash.slice(qIdx + 1));
    const hv = hashParams.get('userid') ?? hashParams.get('userId');
    if (hv?.trim()) return hv.trim();
  }
  return '';
}
