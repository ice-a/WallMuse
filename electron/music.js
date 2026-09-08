// 音乐 — 网易云开放接口（免登录）+ Meting 聚合接口
// 本文件不含具体接口地址：网易云域名与 Meting 实例均由设置提供（wallmuse-config 导入）。
// 网易云（{neteaseBase} 为配置的域名）：
//   搜索  {base}/api/search/get?s=关键词&type=1&limit=30
//   播放  {base}/song/media/outer/url?id={id}.mp3 → 302 到 CDN 音频
//         （VIP / 无版权曲目会 302 到 /404，据此过滤）
//   歌词  {base}/api/song/lyric?id={id}&lv=1&kv=1&tv=-1
// Meting: {base}?server=netease&type=search&id=关键词 → [{ url, name, artist, album, pic, lrc }]
const http = require('http');
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 内置音乐源的协议标记（非 URL，代表使用配置的网易云域名直连）
const NETEASE_MARKER = 'builtin:netease';

const SERVERS = [
  { key: 'netease', name: '网易云' },
  { key: 'tencent', name: 'QQ音乐' },
  { key: 'kugou', name: '酷狗' },
  { key: 'baidu', name: '百度' },
];

function request(urlStr, { timeout = 15000, method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, {
      timeout, method,
      headers: { 'User-Agent': UA, Referer: 'https://music.163.com/', Accept: '*/*', ...headers },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve({ redirect: res.headers.location, status: res.statusCode, headers: res.headers });
      }
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: buf, headers: res.headers }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.end();
  });
}

async function getJson(urlStr, opts = {}) {
  const r = await request(urlStr, opts);
  if (r.redirect) throw new Error('接口发生重定向');
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  try { return JSON.parse(r.body); } catch { throw new Error('响应不是 JSON'); }
}

function normBase(api) {
  return String(api || '').trim().replace(/[/?]+$/, '');
}

// ---------- 网易云 ----------
async function neteaseSearch(wd, base) {
  const j = await getJson(`${base}/api/search/get?${new URLSearchParams({ s: wd, type: '1', limit: '30', offset: '0' })}`);
  const songs = j?.result?.songs || [];
  return songs.map((s) => ({
    id: String(s.id),
    name: s.name || '未知曲目',
    artist: (s.artists || []).map((a) => a.name).filter(Boolean).slice(0, 3).join(' / '),
    album: s.album?.name || '',
    pic: '', // 搜索接口无封面字段；播放条/列表用占位图标
    duration: s.duration || 0,
  }));
}

/** 外链解析：302 到真实 CDN；跳到 /404 表示 VIP / 无版权，不可播 */
async function neteaseResolve(id, base) {
  try {
    const r = await request(`${base}/song/media/outer/url?id=${id}.mp3`);
    const loc = r.redirect || '';
    if (!loc || /\/404/.test(loc)) return '';
    return loc;
  } catch { return ''; }
}

async function neteaseLyric(id, base) {
  try {
    const j = await getJson(`${base}/api/song/lyric?${new URLSearchParams({ id: String(id), lv: '1', kv: '1', tv: '-1' })}`);
    return j?.lrc?.lyric || '';
  } catch { return ''; }
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) {
      const k = i++;
      out[k] = await fn(list[k], k);
    }
  }));
  return out;
}

// ---------- Meting ----------
async function metingSearch(api, server, wd) {
  const base = normBase(api);
  const q = new URLSearchParams({ server, type: 'search', id: wd.trim() });
  const j = await getJson(`${base}?${q}`);
  const list = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : []);
  return list.map((t, i) => ({
    id: String(t.id ?? i),
    name: t.name || t.title || '',
    artist: t.artist || t.author || '',
    album: t.album || '',
    pic: t.pic || t.cover || '',
    url: t.url || '',
    lrc: t.lrc || '',
  })).filter((t) => t.name);
}

// ---------- 对外 ----------
async function search({ api, server = 'netease', wd = '', neteaseBase = '' }) {
  if (!wd.trim()) return { ok: false, error: '请输入搜索关键词' };
  try {
    if (String(api) === NETEASE_MARKER) {
      if (!/^https?:\/\//.test(String(neteaseBase))) {
        return { ok: false, error: '未配置网易云接口地址，请先在设置中导入源配置' };
      }
      const songs = await neteaseSearch(wd.trim(), neteaseBase);
      if (!songs.length) return { ok: false, error: '没有找到结果，换个关键词试试' };
      // 并发解析外链，过滤掉 VIP / 无版权（404）的曲目
      const urls = await mapLimit(songs, 10, (s) => neteaseResolve(s.id, neteaseBase));
      const items = songs
        .map((s, i) => ({ ...s, url: urls[i] || '', lrc: `netease:${s.id}` }))
        .filter((t) => t.url);
      if (!items.length) return { ok: false, error: '搜索到曲目但均无播放链接（多为 VIP 或版权限制），换个关键词试试' };
      return { ok: true, items };
    }
    // Meting 聚合接口
    const base = normBase(api);
    if (!/^https?:\/\//.test(base)) return { ok: false, error: '请输入 http(s) 开头的音乐接口地址' };
    const items = await metingSearch(api, server, wd);
    if (!items.length) return { ok: false, error: '没有找到结果，可换个平台或换个关键词' };
    const playable = items.filter((t) => /^https?:\/\//.test(t.url));
    if (!playable.length) return { ok: false, error: '该平台未返回播放链接，可换个平台或其他接口' };
    return { ok: true, items: playable };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** 歌词：'netease:{id}' → 网易云歌词接口；http(s) 地址 → 直接拉 LRC 文本（Meting） */
async function lyrics(key, neteaseBase = '') {
  key = String(key || '').trim();
  if (!key) return { ok: false, error: '歌词地址无效' };
  try {
    if (key.startsWith('netease:')) {
      if (!/^https?:\/\//.test(String(neteaseBase))) {
        return { ok: false, error: '未配置网易云接口地址，请先在设置中导入源配置' };
      }
      const text = await neteaseLyric(key.slice(8), neteaseBase);
      return text ? { ok: true, text } : { ok: false, error: '暂无歌词' };
    }
    if (/^https?:\/\//.test(key)) {
      const r = await request(key);
      if (r.redirect) return { ok: false, error: '歌词地址发生重定向' };
      return { ok: true, text: r.body };
    }
    return { ok: false, error: '歌词地址无效' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function test(api) {
  const r = await search({ api, server: 'netease', wd: '海阔天空' });
  if (r.ok) return { ok: true, hint: `接口可用（测试搜索到 ${r.items.length} 首可播放）` };
  return { ok: false, hint: r.error };
}

module.exports = { NETEASE_MARKER, SERVERS, search, lyrics, test };
