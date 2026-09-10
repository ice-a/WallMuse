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
const zlib = require('zlib');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const GROUPS = ['image', 'text', 'video'];

// 单次请求超时（毫秒）；重试次数与退避基数
const TIMEOUT = 10000;
const RETRIES = 2;
// 体积上限：图片完整下载上限；视频/文本只要头部与少量响应体即可判定
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_PROBE_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;
// 批量抓取并发上限，避免一次性打满目标站
const CONCURRENCY = 6;
// 图片最小体积，用于过滤 1x1 占位图
const MIN_IMAGE_BYTES = 1024;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Node http 不会自动解压，需按 content-encoding 还原，否则响应体是乱码 */
function decodeBody(buf, encoding) {
  const e = String(encoding || '').toLowerCase();
  try {
    if (e === 'gzip') return zlib.gunzipSync(buf);
    if (e === 'deflate') return zlib.inflateSync(buf);
    if (e === 'br') return zlib.brotliDecompressSync(buf);
  } catch { /* 解压失败时退回原始字节，交由上层判定 */ }
  return buf;
}

/** 把底层错误码翻译成用户能看懂的中文原因 */
function classifyError(e) {
  const msg = String((e && e.message) || e || '未知错误');
  if (e && e.classified) return msg; // 已翻译过，避免二次包裹
  const code = e && e.code;
  if (/certificate|CERT_|SELF_SIGNED/i.test(msg)) return `证书校验失败（${msg}）`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '域名无法解析';
  if (code === 'ECONNREFUSED') return '连接被拒绝';
  if (code === 'ETIMEDOUT' || /超时|timeout/i.test(msg)) return '请求超时';
  if (code === 'ECONNRESET' || /socket hang up/i.test(msg)) return '连接被中途断开';
  if (code === 'EPROTO' || /wrong version number/i.test(msg)) return '协议不匹配（http/https 用错？）';
  return msg;
}

/**
 * 是否值得重试。
 * 注意：证书错误也要重试 —— 很多随机图源会 302 到一组 CDN 分片节点，各节点证书
 * 状态并不一致（实测同一源 4 次里 3 次落在证书过期节点）。重试等于换一个节点，
 * 全过程仍然做完整 TLS 校验，不会为了成功而跳过验证。
 * 域名解析失败、连接被拒属于确定性失败，重试无意义。
 */
function isRetryable(e) {
  const code = e && e.code;
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') return false;
  return true;
}

/**
 * 单跳请求：不跟随重定向，返回 { status, contentType, buf, redirect?, truncated? }
 * maxBytes 大于 0 时，收到足够字节即中断连接，避免为拿一个直链而下载整段视频。
 */
function requestNoFollow(urlStr, { timeout = TIMEOUT, method = 'GET', headers = {}, maxBytes = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error('URL 格式无效')); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('仅支持 http/https'));
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, {
      method, timeout,
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        // 部分图床有防盗链，带来源可显著提高成功率
        Referer: u.origin + '/',
        ...headers,
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve({ status: res.statusCode, redirect: res.headers.location, buf: Buffer.alloc(0) });
      }
      const meta = {
        status: res.statusCode,
        contentType: (res.headers['content-type'] || '').split(';')[0].trim(),
        headers: res.headers,
      };
      const chunks = [];
      let size = 0;
      let done = false;
      const finish = (truncated) => {
        if (done) return;
        done = true;
        resolve({ ...meta, buf: decodeBody(Buffer.concat(chunks), res.headers['content-encoding']), truncated });
      };
      res.on('data', (c) => {
        chunks.push(c);
        size += c.length;
        if (maxBytes && size >= maxBytes) { finish(true); req.destroy(); res.destroy(); }
      });
      res.on('end', () => finish(false));
      res.on('error', (e) => { if (!done) { done = true; reject(e); } });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.end();
  });
}

/** 带重试的单跳请求 */
async function requestWithRetry(urlStr, opts = {}) {
  const retries = opts.retries == null ? RETRIES : opts.retries;
  let last;
  for (let i = 0; i <= retries; i++) {
    if (i) await sleep(300 * 2 ** (i - 1));
    try { return await requestNoFollow(urlStr, opts); } catch (e) {
      last = e;
      if (!isRetryable(e)) break;
    }
  }
  throw last;
}

/** 跟随重定向并记录最终地址（Node 的 res.responseUrl 不存在，必须逐跳手动跟） */
async function requestFinalUrl(urlStr, opts = {}) {
  let cur = urlStr;
  for (let i = 0; i < 8; i++) {
    let hop;
    try {
      hop = await requestWithRetry(cur, opts);
    } catch (e) {
      const err = new Error(classifyError(e));
      err.classified = true;
      throw err;
    }
    if (hop.redirect) { cur = new URL(hop.redirect, cur).href; continue; }
    return { ...hop, finalUrl: cur };
  }
  throw new Error('重定向次数过多');
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

/** 未配置 target 的文案源：取第一个像文案的字符串（非 URL、非纯数字） */
function findTextIn(obj, depth = 0) {
  if (depth > 5 || obj == null) return null;
  if (typeof obj === 'string') {
    const s = obj.trim();
    if (s.length >= 2 && s.length <= 2000 && !ANY_URL_RE.test(s) && /[^\s\d.,;:!?'"()[\]{}<>+\-*/\\|@#$%^&~=`]/.test(s)) return s;
    return null;
  }
  if (Array.isArray(obj)) { for (const v of obj) { const r = findTextIn(v, depth + 1); if (r) return r; } return null; }
  if (typeof obj === 'object') { for (const v of Object.values(obj)) { const r = findTextIn(v, depth + 1); if (r) return r; } }
  return null;
}

const IMG_RE = /^https?:\/\/\S+\.(jpe?g|png|webp|gif)(\?\S*)?$/i;
const VID_RE = /^https?:\/\/\S+\.(mp4|m3u8|mov|m4v)(\?\S*)?$/i;
const ANY_URL_RE = /^https?:\/\/\S+$/i;

/** 有限并发的 map，结果顺序与输入一致 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 按魔数判断图片，用于兜底 content-type 缺失或写成 application/octet-stream 的图床 */
function looksLikeImage(buf) {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;            // JPEG
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // PNG
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') return true;
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return true;
  return false;
}

/** 声明类型不可信时按魔数还原真实类型，避免把 PNG 存成 .jpg */
function imageContentType(buf, declared) {
  if (declared.startsWith('image/')) return declared;
  if (buf[0] === 0x89) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF') return 'image/webp';
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  return 'image/jpeg';
}

const isImageResponse = (r) =>
  r.buf.length >= MIN_IMAGE_BYTES && (r.contentType.startsWith('image/') || looksLikeImage(r.buf));
const isVideoResponse = (r) =>
  r.contentType.startsWith('video/') || r.contentType.includes('mpegurl') || VID_RE.test(r.finalUrl);

/** 从响应体里挑出直链：优先按期望类型匹配，退化为任意 http(s) 链接 */
function pickUrl(body, group) {
  const re = group === 'image' ? IMG_RE : VID_RE;
  const tokens = body.split(/[\s"'`]+/).filter(Boolean);
  return tokens.find((x) => re.test(x)) || tokens.find((x) => ANY_URL_RE.test(x)) || null;
}

// ---------- 对外能力 ----------
/** 解析一个源，得到最终可用的媒体地址或文字。永不抛异常，失败统一返回 { ok:false, error } */
async function resolveSource(src) {
  const group = src.group || 'text';
  const kind = src.kind || 'direct';
  try {
    if (kind === 'json') return await resolveJson(src, group);
    if (group === 'text') return await resolveText(src);
    return await resolveMedia(src, group);
  } catch (e) {
    return { ok: false, error: classifyError(e) };
  }
}

async function resolveJson(src, group) {
  const r = await requestFinalUrl(src.url, { maxBytes: MAX_PROBE_BYTES });
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` };
  let j;
  try { j = JSON.parse(r.buf.toString('utf8')); } catch { return { ok: false, error: '响应不是 JSON' }; }
  const v = src.target ? deepGet(j, src.target) : undefined;
  if (v == null) {
    // 未配 target 或字段取不到时，扫一遍 JSON 兜底，避免整源报废
    const found = group === 'text'
      ? findTextIn(j)
      : findUrlIn(j, group === 'image' ? IMG_RE : VID_RE) || findUrlIn(j, ANY_URL_RE);
    if (!found) return { ok: false, error: src.target ? `JSON 中无字段 ${src.target}` : '未配置取值字段且未能自动识别' };
    return group === 'text' ? { ok: true, text: String(found) } : { ok: true, url: String(found), via: 'json-scan' };
  }
  const s = String(v).trim();
  if (!s) return { ok: false, error: `字段 ${src.target} 取到空值` };
  if (group === 'text') return { ok: true, text: s };
  return { ok: true, url: s, via: 'json' };
}

/** 极简标签剥离：仅用于把 HTML 包裹的纯文案还原出来，不做排版处理 */
function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function resolveText(src) {
  const r = await requestFinalUrl(src.url, { maxBytes: MAX_TEXT_BYTES });
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` };
  if (r.contentType.startsWith('image/') || r.contentType.startsWith('video/')) {
    return { ok: false, error: '该源返回的是媒体而非文字' };
  }
  let t = r.buf.toString('utf8').trim();
  if (src.trimBanner) t = t.replace(/━+|─+/g, '').replace(/Tips[:：].*$/s, '').trim();
  if (!t) return { ok: false, error: '响应为空' };
  if (t[0] === '<') t = stripTags(t);
  if (!t) return { ok: false, error: '响应是 HTML 且未提取到文字' };
  if (t.length > 8000) return { ok: false, error: `响应过长（${t.length} 字符），可能不是文案接口` };
  return { ok: true, text: t };
}

async function resolveMedia(src, group) {
  const isVid = group === 'video';
  // 视频只需判定类型/取直链，截断在 64KB，避免为拿一个 URL 下载整段视频
  const r = await requestFinalUrl(src.url, { maxBytes: isVid ? MAX_PROBE_BYTES : MAX_IMAGE_BYTES });
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` };

  if (isVid && isVideoResponse(r)) return { ok: true, url: r.finalUrl, contentType: r.contentType };
  if (!isVid && isImageResponse(r)) {
    return { ok: true, buf: r.buf, contentType: imageContentType(r.buf, r.contentType), finalUrl: r.finalUrl };
  }

  const body = r.buf.toString('utf8').trim();
  let u = body && body.length < MAX_TEXT_BYTES && body[0] !== '<' ? pickUrl(body, group) : null;
  if (!u && body) {
    try {
      const j = JSON.parse(body);
      u = findUrlIn(j, isVid ? VID_RE : IMG_RE) || findUrlIn(j, ANY_URL_RE);
    } catch { /* 非 JSON，忽略 */ }
  }
  if (!u) {
    return { ok: false, error: `响应类型不符（${r.contentType || '未知'}，${(r.buf.length / 1024).toFixed(0)}KB）` };
  }

  if (isVid) return { ok: true, url: u, via: 'texturl' };
  // 图片直链需二次确认，防止把错误页当图片存下来
  const r2 = await requestFinalUrl(u, { maxBytes: MAX_IMAGE_BYTES });
  if (r2.status !== 200 || !isImageResponse(r2)) return { ok: false, error: '直链二次请求失败' };
  return { ok: true, buf: r2.buf, contentType: imageContentType(r2.buf, r2.contentType), finalUrl: r2.finalUrl, via: 'texturl' };
}

/**
 * 抓取一批图片。多源时轮流分配，并发受限；
 * 单个源失败自动换下一个源重试一次，避免个别坏源拖垮整批。
 */
async function fetchImageBatch({ source, sources, count = 6, destDir }) {
  const list = (Array.isArray(sources) && sources.length ? sources : source ? [source] : []).filter(Boolean);
  if (!list.length) return { ok: false, error: '未指定图片源' };
  fs.mkdirSync(destDir, { recursive: true });
  const n = Math.min(Math.max(1, count), 24);

  const results = await mapLimit(Array.from({ length: n }, (_, i) => i), CONCURRENCY, async (i) => {
    const primary = list[i % list.length];
    const chain = list.length > 1 ? [primary, list[(i + 1) % list.length]] : [primary];
    let last = { ok: false, error: '未知错误' };
    for (const src of chain) {
      const r = await resolveSource({ ...src, group: 'image' });
      if (r.ok && r.buf) return { ...r, srcName: src.name };
      if (r.error) last = r;
    }
    return last;
  });

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
  const r = await resolveSource({ ...src, kind: src.kind || 'direct' });
  if (r.ok) {
    if (r.text) return { ok: true, hint: `取到文字：${r.text.slice(0, 40)}` };
    if (r.url) return { ok: true, hint: `解析到地址：${r.url.slice(0, 70)}` };
    if (r.buf) return { ok: true, hint: `图片有效（${(r.buf.length / 1024).toFixed(0)} KB）` };
  }
  return { ok: false, hint: r.error || '解析失败' };
}

module.exports = {
  listSources, fetchImageBatch, resolveVideo, fetchText, testSource,
  resolveSource, requestFinalUrl, deepGet, UA,
};
