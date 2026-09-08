// 接口内容源解析引擎 — 本文件不含任何具体源/接口地址。
// 源配置（内置源 + 用户自定义源）由设置提供（wallmuse-config 导入，存于数据目录 .env）。
// 源条目形态：{ key?, name, url, kind, target?, trimBanner? }，三种响应形态：
//   direct  : 302 直跳图片/视频，跟随重定向即可
//   texturl : 响应体是纯文本的图片/视频直链，需二次请求
//   json    : JSON 响应，target 取字段（URL 或文字）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const GROUPS = ['image', 'text', 'video'];

/** 合并导入的内置源与用户自定义源（自定义优先展示在前） */
function listSources(builtin = {}, custom = {}) {
  const out = {};
  for (const g of GROUPS) {
    const b = (Array.isArray(builtin[g]) ? builtin[g] : []).filter((s) => s && s.url);
    const c = (custom[g] || []).map((s) => ({
      key: 'c_' + (s.id || crypto.randomUUID()), name: s.name || '自定义', url: s.url,
      kind: s.kind || 'direct', target: s.target || '', custom: true, group: g,
    }));
    out[g] = [...c, ...b.map((s) => ({ ...s, group: g }))];
  }
  return out;
}

// ---------- HTTP 基础 ----------
function request(urlStr, { timeout = 20000, method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, {
      method, timeout,
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(request(new URL(res.headers.location, urlStr).href, { timeout, method: 'GET', headers }));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        contentType: (res.headers['content-type'] || '').split(';')[0].trim(),
        buf: Buffer.concat(chunks),
        finalUrl: res.responseUrl || urlStr,
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.end();
  });
}

/** 兼容 res.responseUrl 缺失：手动逐跳跟随并记录最终地址 */
async function requestFinalUrl(urlStr, opts = {}) {
  let cur = urlStr;
  for (let i = 0; i < 6; i++) {
    const hop = await requestNoFollow(cur, opts);
    if (hop.redirect) { cur = new URL(hop.redirect, cur).href; continue; }
    return { ...hop, finalUrl: cur };
  }
  throw new Error('重定向次数过多');
}

function requestNoFollow(urlStr, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method: 'GET', timeout, headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve({ redirect: res.headers.location });
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        contentType: (res.headers['content-type'] || '').split(';')[0].trim(),
        buf: Buffer.concat(chunks),
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.end();
  });
}

function deepGet(o, p) {
  let cur = o;
  for (const k of String(p).split('.')) {
    if (cur == null) return undefined;
    const arr = k.endsWith('[]');
    cur = arr ? cur[k.slice(0, -2)] : cur[k];
    if (arr && Array.isArray(cur)) cur = cur[0];
  }
  return cur;
}

function findUrlIn(obj, re, depth = 0) {
  if (depth > 5 || obj == null) return null;
  if (typeof obj === 'string') return re.test(obj) ? obj : null;
  if (Array.isArray(obj)) { for (const v of obj) { const r = findUrlIn(v, re, depth + 1); if (r) return r; } return null; }
  if (typeof obj === 'object') { for (const v of Object.values(obj)) { const r = findUrlIn(v, re, depth + 1); if (r) return r; } }
  return null;
}

const IMG_RE = /^https?:\/\/\S+\.(jpe?g|png|webp|gif)(\?\S*)?$/i;
const VID_RE = /^https?:\/\/\S+\.(mp4|m3u8|mov|m4v)(\?\S*)?$/i;

// ---------- 对外能力 ----------
/** 解析一个源，得到最终可用的媒体地址或文字 */
async function resolveSource(src) {
  const kind = src.kind || 'direct';
  if (kind === 'json') {
    const r = await requestFinalUrl(src.url);
    if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` };
    let j;
    try { j = JSON.parse(r.buf.toString('utf8')); } catch { return { ok: false, error: '响应不是 JSON' }; }
    const v = src.target ? deepGet(j, src.target) : undefined;
    if (v == null) return { ok: false, error: `JSON 中无字段 ${src.target}` };
    const s = String(v).trim();
    if (src.group === 'text') return { ok: true, text: s };
    return { ok: true, url: s, via: 'json' }; // 图片/视频：字段值应是直链
  }
  // direct / texturl / plain
  const r = await requestFinalUrl(src.url);
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` };
  const ct = r.contentType;
  if (src.group === 'text') {
    if (ct.startsWith('image/') || ct.startsWith('video/')) return { ok: false, error: '该源返回的是媒体而非文字' };
    let t = r.buf.toString('utf8').trim();
    if (src.trimBanner) t = t.replace(/━+|─+|─+/g, '').replace(/Tips[:：].*$/s, '').trim();
    if (!t || t.length > 1000 || t.startsWith('<')) return { ok: false, error: '响应为空或非文本' };
    return { ok: true, text: t };
  }
  // 图片/视频
  if (src.group === 'image' && ct.startsWith('image/') && r.buf.length > 10 * 1024) {
    return { ok: true, buf: r.buf, contentType: ct, finalUrl: r.finalUrl };
  }
  if (src.group === 'video' && (ct.startsWith('video/') || VID_RE.test(r.finalUrl) || ct.includes('mpegurl'))) {
    return { ok: true, url: r.finalUrl, contentType: ct };
  }
  // texturl / direct 失败兜底：响应体是直链文本
  const body = r.buf.toString('utf8').trim();
  if (body && body.length < 2000 && !body.startsWith('<')) {
    const u = body.split(/\s+/).find((x) => (src.group === 'image' ? IMG_RE : VID_RE).test(x) || /^https?:\/\/\S+/i.test(x));
    if (u) {
      if (src.group === 'image') {
        const r2 = await requestFinalUrl(u);
        if (r2.status === 200 && r2.contentType.startsWith('image/') && r2.buf.length > 10 * 1024) {
          return { ok: true, buf: r2.buf, contentType: r2.contentType, finalUrl: r2.finalUrl };
        }
        return { ok: false, error: '直链二次请求失败' };
      }
      return { ok: true, url: u, via: 'texturl' };
    }
    if (src.group === 'video') {
      // json 响应里找视频链接（自定义源常见）
      try {
        const j = JSON.parse(body);
        const u2 = findUrlIn(j, VID_RE) || findUrlIn(j, /^https?:\/\/\S+/i);
        if (u2) return { ok: true, url: u2, via: 'json-scan' };
      } catch { /* ignore */ }
    }
  }
  return { ok: false, error: `响应类型不符（${ct || '未知'}，${(r.buf.length / 1024).toFixed(0)}KB）` };
}

/** 抓取一批图片（多源时按数量轮流分配），返回 { ok, paths, names, source, failed, error? } */
async function fetchImageBatch({ source, sources, count = 6, destDir }) {
  const list = (Array.isArray(sources) && sources.length ? sources : source ? [source] : [])
    .filter(Boolean);
  if (!list.length) return { ok: false, error: '未指定图片源' };
  fs.mkdirSync(destDir, { recursive: true });
  const n = Math.min(Math.max(1, count), 24);
  const results = await Promise.all(Array.from({ length: n }, (_, i) => {
    const src = list[i % list.length];
    return resolveSource({ ...src, group: 'image' })
      .then((r) => (r.ok ? { ...r, srcName: src.name } : r))
      .catch((e) => ({ ok: false, error: String(e.message || e) }));
  }));
  const seen = new Set();
  const paths = [];
  const names = [];
  let failed = 0;
  const EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
  for (const r of results) {
    if (!r || !r.ok || !r.buf) { failed++; continue; }
    const hash = crypto.createHash('md5').update(r.buf).digest('hex');
    if (seen.has(hash)) continue;
    seen.add(hash);
    const ext = EXT[r.contentType] || '.jpg';
    const file = path.join(destDir, `api_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
    try { fs.writeFileSync(file, r.buf); paths.push(file); names.push(r.srcName || ''); } catch { failed++; }
  }
  if (!paths.length) {
    const firstErr = results.find((r) => r && r.error);
    return { ok: false, error: (firstErr && firstErr.error) || '全部失败，请换一个源试试', failed };
  }
  return { ok: true, paths, names, source: list.length > 1 ? '混合抓取' : list[0].name, failed };
}

/** 解析视频源为可播放地址 */
async function resolveVideo(source) {
  const r = await resolveSource({ ...source, group: 'video' });
  if (!r.ok) return r;
  return { ok: true, url: r.url, source: source.name };
}

/** 取一条文字 */
async function fetchText(source) {
  const r = await resolveSource({ ...source, group: 'text' });
  if (!r.ok) return r;
  return { ok: true, text: r.text, source: source.name };
}

/** 测试自定义源：返回 { ok, hint } */
async function testSource(src) {
  try {
    const r = await resolveSource({ ...src, kind: src.kind || 'direct' });
    if (r.ok) {
      if (r.text) return { ok: true, hint: `取到文字：${r.text.slice(0, 40)}` };
      if (r.url) return { ok: true, hint: `解析到地址：${r.url.slice(0, 70)}` };
      if (r.buf) return { ok: true, hint: `图片有效（${(r.buf.length / 1024).toFixed(0)} KB）` };
    }
    return { ok: false, hint: r.error || '解析失败' };
  } catch (e) {
    return { ok: false, hint: String(e.message || e) };
  }
}

module.exports = { listSources, fetchImageBatch, resolveVideo, fetchText, testSource };
