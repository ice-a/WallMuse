// Vercel Serverless — Web 模式统一 RPC 入口（POST /api/rpc）
// 前端 src/web-adapter.js 通过 fetch 调用；服务端复用 electron/ 下的纯 Node 服务模块。
// 敏感配置（API Key 等）从 Vercel 环境变量 WALLMUSE_* 读取（JSON 值），永不回传给浏览器；
// 客户端随请求带自己的非敏感设置，服务端只在客户端值为空时用环境变量兜底。
const wallhaven = require('../electron/wallhaven');
const bing = require('../electron/bing');
const apisrc = require('../electron/apisrc');
const cms = require('../electron/cms');
const music = require('../electron/music');
const ai = require('../electron/ai');
const chat = require('../electron/chat');

const UA = apisrc.UA;

// 服务端托管的配置键（与桌面版 .env 键一致）
const ENV_KEYS = [
  'aiPresets', 'aiActive', 'chatPresets', 'chatActive',
  'cmsApis', 'musicApis', 'customSources', 'builtinSources',
  'randomChains', 'endpoints', 'wallhavenApiKey',
];

function envSettings() {
  const out = {};
  for (const k of ENV_KEYS) {
    const v = process.env['WALLMUSE_' + k];
    if (!v) continue;
    try { out[k] = JSON.parse(v); } catch { out[k] = v; }
  }
  return out;
}

function srcCount(o) {
  return ['image', 'text', 'video'].reduce((n, g) => n + ((o && Array.isArray(o[g])) ? o[g].length : 0), 0);
}

function isEmptyVal(k, v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return !v.length;
  if (k === 'customSources' || k === 'builtinSources') return srcCount(v) === 0;
  if (k === 'randomChains') return !((v.desktop || []).length || (v.mobile || []).length);
  if (k === 'endpoints') return !Object.keys(v).length;
  return false;
}

/** 合成生效配置：客户端设置优先，空缺键用服务端环境变量兜底；预设缺 apiKey 时按序补齐 */
function resolveCfg(client) {
  const env = envSettings();
  const cfg = { ...(client && typeof client === 'object' ? client : {}) };
  for (const k of ENV_KEYS) {
    if (isEmptyVal(k, cfg[k]) && env[k] != null) cfg[k] = env[k];
  }
  for (const k of ['aiPresets', 'chatPresets']) {
    if (Array.isArray(cfg[k]) && Array.isArray(env[k])) {
      cfg[k] = cfg[k].map((p, i) => (p && !p.apiKey && env[k][i] && env[k][i].apiKey)
        ? { ...p, apiKey: env[k][i].apiKey } : p);
    }
  }
  return cfg;
}

/** 剥掉密钥后的服务端配置（可安全下发给浏览器） */
function publicEnvSettings() {
  const env = envSettings();
  delete env.wallhavenApiKey;
  for (const k of ['aiPresets', 'chatPresets']) {
    if (Array.isArray(env[k])) env[k] = env[k].map((p) => ({ ...(p || {}), apiKey: '' }));
  }
  return env;
}

/** 跟随重定向直到拿到图片直链（不下载 body），失败返回 null */
function probeImageUrl(urlStr, timeout = 20000, left = 6) {
  return new Promise((resolve) => {
    if (left <= 0) return resolve(null);
    let u;
    try { u = new URL(urlStr); } catch { return resolve(null); }
    const mod = u.protocol === 'http:' ? require('http') : require('https');
    const req = mod.get(u, { timeout, headers: { 'User-Agent': UA, Accept: 'image/*,*/*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(probeImageUrl(new URL(res.headers.location, u).href, timeout, left - 1));
      }
      const ct = (res.headers['content-type'] || '').split(';')[0].trim();
      res.resume();
      resolve(res.statusCode === 200 && ct.startsWith('image/') ? u.href : null);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/** Web 抓图：解析出最终直链（浏览器直接加载，服务端不落盘/不转发大体积 body） */
async function webApiImages({ args, cfg }) {
  const { source, count } = args[0] || {};
  const all = apisrc.listSources(cfg.builtinSources || {}, cfg.customSources || {});
  const list = source && source.key === '__mix__'
    ? all.image
    : all.image.filter((s) => s.key === (source && source.key));
  if (!list.length) return { ok: false, error: '未指定图片源' };
  const n = Math.min(Math.max(1, Number(count) || 6), 24);
  const results = await Promise.all(Array.from({ length: n }, (_, i) => {
    const src = list[i % list.length];
    return apisrc.resolveSource({ ...src, group: 'image' })
      .then((r) => (r.ok ? { url: r.finalUrl || r.url, srcName: src.name } : { error: r.error }))
      .catch((e) => ({ error: String(e.message || e) }));
  }));
  const items = [];
  let failed = 0;
  const seen = new Set();
  for (const r of results) {
    if (!r.url || seen.has(r.url)) { if (r.error) failed++; continue; }
    seen.add(r.url);
    items.push({ url: r.url, name: r.srcName || '' });
  }
  if (!items.length) {
    const firstErr = results.find((r) => r && r.error);
    return { ok: false, error: (firstErr && firstErr.error) || '全部失败，请换一个源试试', failed };
  }
  return { ok: true, items, failed, source: list.length > 1 ? '混合抓取' : list[0].name };
}

async function webRandFetch({ args, cfg }) {
  const { kind = 'desktop', count = 12 } = args[0] || {};
  const chains = cfg.randomChains || {};
  const chain = chains[kind] || chains.desktop || [];
  if (!chain.length) return { ok: false, error: '未配置随机壁纸源（WALLMUSE_randomChains）' };
  const n = Math.min(Math.max(1, Number(count) || 12), 24);
  const results = await Promise.all(Array.from({ length: n }, (_, i) => {
    const ep = chain[i % chain.length];
    return probeImageUrl(ep.url).then((url) => (url ? { url, source: ep.name } : null));
  }));
  const items = [];
  const seen = new Set();
  let failed = 0;
  for (const r of results) {
    if (!r || seen.has(r.url)) { failed++; continue; }
    seen.add(r.url);
    items.push(r);
  }
  if (!items.length) return { ok: false, error: '所有随机源均不可达，请检查 WALLMUSE_randomChains 配置' };
  return { ok: true, items, failed };
}

/** AI 配置解析：客户端测试请求不带密钥时，用服务端同 BaseURL+模型 或首个预设的密钥补齐 */
function withServerKey(cfg, clientCfg) {
  const c = { ...(clientCfg || {}) };
  if (!c.apiKey) {
    const envPresets = envSettings().aiPresets || [];
    const hit = envPresets.find((p) => p && p.baseUrl === c.baseUrl && p.model === c.model) || envPresets[0];
    if (hit && hit.apiKey) c.apiKey = hit.apiKey;
  }
  return c;
}

async function webAiGenerate({ args, cfg }) {
  const { prompt, size, presetIndex } = args[0] || {};
  const idx = presetIndex == null ? (cfg.aiActive || 0) : Number(presetIndex);
  const p = (cfg.aiPresets || [])[idx] || {};
  if (!p.baseUrl || !p.model) {
    return { ok: false, error: '未配置 AI 接口（服务端 WALLMUSE_aiPresets 环境变量，或客户端设置）' };
  }
  const r = await ai.generate({
    baseUrl: p.baseUrl, apiKey: p.apiKey || '', model: p.model,
    prompt: String(prompt || ''), size: size || '1024x1024',
  });
  if (!r.ok) return r;
  if (r.b64 && r.b64.length > 3.2 * 1024 * 1024) {
    return { ok: false, error: '生成图片超过响应上限（约 3MB），请换更小的尺寸或模型' };
  }
  return { ok: true, dataUrl: 'data:image/png;base64,' + r.b64.toString('base64') };
}

async function webChatSend({ args, cfg }) {
  const { presetIndex, messages, system } = args[0] || {};
  const i = presetIndex == null ? (cfg.chatActive || 0) : Number(presetIndex);
  const p = (cfg.chatPresets || [])[i] || {};
  if (!p.baseUrl || !p.model) {
    return { ok: false, error: '未配置对话模型（服务端 WALLMUSE_chatPresets 环境变量，或客户端设置）' };
  }
  const sys = String(system || '').trim();
  const full = sys ? [{ role: 'system', content: sys }, ...messages] : messages;
  // Serverless 下不做逐字流式：整体返回，前端适配器一次性展示
  const r = await chat.chatStream({
    baseUrl: p.baseUrl, apiKey: p.apiKey || '', model: p.model,
    messages: full, temperature: 0.7,
  }, null);
  return { ok: r.ok, content: r.content, error: r.error };
}

/** 服务端代理拉取配置 URL（绕过浏览器 CORS），内容校验交给客户端 */
async function webImportUrl({ args }) {
  const urlStr = String((args[0] && args[0].url) || '').trim();
  let u;
  try { u = new URL(urlStr); } catch { return { ok: false, error: 'URL 格式无效' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: '仅支持 http(s) 地址' };
  const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': UA, Accept: 'application/json,*/*' } });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}，请检查地址是否可公开访问` };
  const text = await r.text();
  try { return { ok: true, data: JSON.parse(text) }; }
  catch { return { ok: false, error: 'URL 内容不是合法 JSON，请确认指向的是 WallMuse 配置文件' }; }
}

const handlers = {
  'env:get': () => ({ ok: true, settings: publicEnvSettings() }),
  // 发现
  'wh:search': ({ args, cfg }) => wallhaven.search(args[0], cfg.endpoints?.wallhaven, cfg.wallhavenApiKey),
  'bing:search': ({ args, cfg }) => bing.search(args[0], cfg.endpoints?.bing),
  'api:sources': ({ cfg }) => apisrc.listSources(cfg.builtinSources || {}, cfg.customSources || {}),
  'api:test': ({ args }) => apisrc.testSource(args[0]),
  'api:text': ({ args }) => apisrc.fetchText(args[0]),
  'api:video': ({ args }) => apisrc.resolveVideo(args[0]),
  'api:image:web': webApiImages,
  'rand:fetch:web': webRandFetch,
  // 影视
  'cms:presets': ({ cfg }) => [...cms.presets(), ...(cfg.cmsApis || [])],
  'cms:search': ({ args }) => cms.search(args[0]),
  'cms:detail': ({ args }) => cms.detail(args[0]),
  'cms:test': ({ args }) => cms.test(args[0]),
  // 音乐
  'music:presets': ({ cfg }) => cfg.musicApis || [],
  'music:search': ({ args, cfg }) => music.search({ ...args[0], neteaseBase: cfg.endpoints?.netease }),
  'music:lyrics': ({ args, cfg }) => music.lyrics(args[0], cfg.endpoints?.netease),
  'music:test': ({ args }) => music.test(args[0]),
  // AI
  'ai:test': ({ args, cfg }) => ai.test(withServerKey(cfg, args[0])),
  'ai:generate:web': webAiGenerate,
  'chat:models': ({ args }) => chat.listModels(args[0]),
  'chat:test': ({ args, cfg }) => chat.test(withServerKey(cfg, args[0])),
  'chat:send': webChatSend,
  // 配置
  'config:importUrl:web': webImportUrl,
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: '仅支持 POST' });
  let body = null;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch { return res.status(400).json({ ok: false, error: '请求体不是合法 JSON' }); }
  const { channel, args = [], settings = null } = body || {};
  const handler = handlers[channel];
  if (!handler) return res.status(404).json({ ok: false, error: `未知通道：${channel}` });
  try {
    const cfg = resolveCfg(settings);
    const result = await handler({ args, cfg, settings });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
};

module.exports.config = { maxDuration: 60 };
