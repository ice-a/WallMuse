// Web 部署适配器 — 浏览器环境下接管 window.wallmuse（桌面版由 electron/preload.js 提供）
// 网络能力经 /api/rpc 调用 Vercel Serverless；个人数据（设置/图库/对话/小说）存 localStorage。
// 敏感配置（API Key）只存在于服务端环境变量，浏览器拿到的配置中密钥恒为空。
const K = { settings: 'wm.settings', items: 'wm.items', chats: 'wm.chats', novels: 'wm.novels' };

const DEFAULTS = {
  theme: 'dark', autoRotate: false, rotateMinutes: 30, rotateFilter: {},
  aiPresets: [], aiActive: 0, aiBaseUrl: '', aiApiKey: '', aiModel: '',
  chatPresets: [], chatActive: 0,
  customSources: { image: [], text: [], video: [] },
  builtinSources: { image: [], text: [], video: [] },
  randomChains: { desktop: [], mobile: [] },
  endpoints: {}, cmsApis: [], musicApis: [],
};

function lsGet(key, d) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? d : v; } catch { return d; }
}
function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 容量满时静默 */ } }

async function rpc(channel, ...args) {
  const res = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, args, settings: lsGet(K.settings, {}) }),
  });
  if (!res.ok) throw new Error('服务请求失败 HTTP ' + res.status);
  return res.json();
}

let envCache = null;
async function envSettings() {
  if (!envCache) {
    try { envCache = (await rpc('env:get')).settings || {}; } catch { envCache = {}; }
  }
  return envCache;
}

async function mergedSettings() {
  return { ...DEFAULTS, ...(await envSettings()), ...lsGet(K.settings, {}) };
}

// ---------- 图库（localStorage） ----------
function getItems() { return lsGet(K.items, []); }
function putItems(items) { lsSet(K.items, items.slice(-500)); }

function addItems(entries) {
  const items = getItems();
  const known = new Set(items.map((i) => i.path));
  const added = [];
  for (const e of entries || []) {
    if (!e || !e.path || known.has(e.path)) continue;
    known.add(e.path);
    added.push({
      id: crypto.randomUUID(), path: e.path, originalPath: e.path,
      name: e.name || '图片', source: e.source || 'download', prompt: e.prompt || '',
      sourceId: '', sourceUrl: '', tags: [], favorite: false, collections: [],
      size: e.size || 0, addedAt: Date.now(), appliedAt: 0,
    });
  }
  if (added.length) putItems([...items, ...added]);
  return added;
}

function mutateItem(id, fn) {
  const items = getItems();
  const it = items.find((i) => i.id === id);
  if (!it) return null;
  fn(it);
  putItems(items);
  return it;
}

// ---------- 配置导入 / 导出 ----------
function summarize(cfg) {
  const parts = [];
  const srcCount = (o) => ['image', 'text', 'video'].reduce((n, g) => n + ((o && o[g]) || []).length, 0);
  if (cfg.aiPresets?.length) parts.push(`生图预设 ${cfg.aiPresets.length}`);
  if (cfg.chatPresets?.length) parts.push(`对话预设 ${cfg.chatPresets.length}`);
  if (srcCount(cfg.builtinSources)) parts.push(`内容源 ${srcCount(cfg.builtinSources)}`);
  if (srcCount(cfg.customSources)) parts.push(`自定义源 ${srcCount(cfg.customSources)}`);
  if (cfg.cmsApis?.length) parts.push(`影视源 ${cfg.cmsApis.length}`);
  if (cfg.musicApis?.length) parts.push(`音乐源 ${cfg.musicApis.length}`);
  if (cfg.randomChains && ((cfg.randomChains.desktop || []).length + (cfg.randomChains.mobile || []).length)) parts.push('随机源');
  if (cfg.endpoints && Object.keys(cfg.endpoints).length) parts.push(`功能接口 ${Object.keys(cfg.endpoints).length}`);
  return parts.length ? parts.join('、') : '应用偏好设置';
}

function applyImported(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '不是有效的 WallMuse 配置文件' };
  const body = raw.type === 'wallmuse-config' ? raw.settings : raw;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: '不是有效的 WallMuse 配置文件' };
  if (!Object.keys(body).length) return { ok: false, error: '配置内容为空' };
  lsSet(K.settings, { ...lsGet(K.settings, {}), ...body });
  return { ok: true, summary: summarize(body), hasKeys: !!(body.aiApiKey || (body.aiPresets || []).some((p) => p.apiKey)) };
}

function downloadBlob(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const DESKTOP_ONLY = (what) => () => ({ ok: false, error: `${what}是桌面版功能，Web 模式不支持` });
const NOT_SET = { ok: false, error: 'Web 模式不支持设为壁纸（请在桌面版使用，或直接下载原图）' };

export function createWebAdapter() {
  let chunkCb = null;
  return {
    platform: async () => ({ platform: 'web', backend: 'Web 模式（Vercel）' }),
    onRotated: () => () => {},
    onChatChunk: (cb) => { chunkCb = cb; return () => { chunkCb = null; }; },

    // ---------- 设置 ----------
    getSettings: mergedSettings,
    setSettings: async (patch) => {
      lsSet(K.settings, { ...lsGet(K.settings, {}), ...patch });
      return mergedSettings();
    },

    // ---------- 图库 ----------
    list: async () => getItems(),
    import: async () => ({ added: 0, message: 'Web 模式请使用「发现」页抓取入库' }),
    toggleFav: async (id) => mutateItem(id, (it) => { it.favorite = !it.favorite; }),
    addTag: async (id, tag) => {
      tag = String(tag || '').trim();
      return tag ? mutateItem(id, (it) => { if (!it.tags.includes(tag)) it.tags.push(tag); }) : null;
    },
    removeTag: async (id, tag) => mutateItem(id, (it) => { it.tags = it.tags.filter((t) => t !== tag); }),
    addToCollection: async (id, name) => {
      name = String(name || '').trim();
      return name ? mutateItem(id, (it) => { if (!it.collections.includes(name)) it.collections.push(name); }) : null;
    },
    removeFromCollection: async (id, name) => mutateItem(id, (it) => { it.collections = it.collections.filter((c) => c !== name); }),
    remove: async (id) => { putItems(getItems().filter((i) => i.id !== id)); return true; },
    reveal: DESKTOP_ONLY('在文件管理器中显示'),
    setWallpaper: async () => NOT_SET,
    randomWallpaper: async () => NOT_SET,

    // ---------- 数据存储（浏览器本地） ----------
    storageStatus: async () => {
      const items = getItems();
      return {
        configured: true, dataDir: '浏览器本地存储（localStorage）', defaultDir: '',
        itemCount: items.length, sizeBytes: JSON.stringify(items).length,
      };
    },
    storagePick: async () => ({ canceled: true }),
    storageUse: DESKTOP_ONLY('切换数据目录'),
    storageMigrate: DESKTOP_ONLY('迁移数据目录'),

    // ---------- 发现 ----------
    whSearch: (p) => rpc('wh:search', p),
    whDownload: async (wall) => {
      const added = addItems([{ path: wall.path, name: wall.id, source: 'download' }]);
      return added.length ? { ok: true, item: added[0] } : { ok: true };
    },
    bingSearch: (p) => rpc('bing:search', p),
    bingDownload: async (wall) => {
      const added = addItems([{ path: wall.path, name: wall.name || wall.id, source: 'download' }]);
      return added.length ? { ok: true, item: added[0] } : { ok: true };
    },
    randFetch: async ({ kind, count }) => {
      const r = await rpc('rand:fetch:web', { kind, count });
      if (!r.ok) return r;
      const items = addItems(r.items.map((x) => ({ path: x.url, name: '随机壁纸' })));
      return { ok: true, items, failed: r.failed || 0 };
    },
    apiSources: () => rpc('api:sources'),
    apiImage: async ({ source, count }) => {
      const r = await rpc('api:image:web', { source, count });
      if (!r.ok) return r;
      const items = addItems(r.items.map((x) => ({ path: x.url, name: x.name || '接口图片' })));
      return { ok: true, items, failed: r.failed || 0 };
    },
    apiText: ({ source }) => rpc('api:text', { source }),
    apiVideo: ({ source }) => rpc('api:video', { source }),
    apiTest: (src) => rpc('api:test', src),

    // ---------- 影视 ----------
    cmsPresets: () => rpc('cms:presets'),
    cmsSearch: (p) => rpc('cms:search', p),
    cmsDetail: (p) => rpc('cms:detail', p),
    cmsTest: (api) => rpc('cms:test', api),

    // ---------- 音乐 ----------
    musicPresets: () => rpc('music:presets'),
    musicSearch: (p) => rpc('music:search', p),
    musicLyrics: (url) => rpc('music:lyrics', url),
    musicTest: (api) => rpc('music:test', api),

    // ---------- 小说 ----------
    getNovels: async () => lsGet(K.novels, []),
    setNovels: async (list) => { lsSet(K.novels, Array.isArray(list) ? list : []); },

    // ---------- AI ----------
    aiGenerate: async ({ prompt, size }) => {
      const r = await rpc('ai:generate:web', { prompt, size });
      if (!r.ok) return r;
      const [item] = addItems([{ path: r.dataUrl, name: String(prompt || 'ai').slice(0, 40), source: 'ai', prompt }]);
      return { ok: true, path: r.dataUrl, item };
    },
    aiTest: (cfg) => rpc('ai:test', cfg),

    // ---------- AI 对话 ----------
    chatModels: (cfg) => rpc('chat:models', cfg),
    chatTest: (cfg) => rpc('chat:test', cfg),
    chatSend: (params) => rpc('chat:send', params),
    getChats: async () => lsGet(K.chats, []),
    setChats: async (list) => { lsSet(K.chats, Array.isArray(list) ? list.slice(-400) : []); },

    // ---------- 配置备份 ----------
    configExport: async () => {
      const s = lsGet(K.settings, {});
      const data = {
        app: 'WallMuse', type: 'wallmuse-config', version: 1,
        exportedAt: new Date().toISOString(), settings: s,
      };
      downloadBlob(`wallmuse-config-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
      return { ok: true, path: '浏览器下载', summary: summarize(s) };
    },
    configImport: () => new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        if (!input.files || !input.files[0]) return resolve({ canceled: true });
        try { resolve(applyImported(JSON.parse(await input.files[0].text()))); }
        catch (e) { resolve({ ok: false, error: '导入失败：' + (e.message || e) }); }
      };
      input.oncancel = () => resolve({ canceled: true });
      input.click();
    }),
    configImportUrl: async (url) => {
      const r = await rpc('config:importUrl:web', { url });
      return r.ok ? applyImported(r.data) : r;
    },

    // ---------- .env（Web 下在 Vercel 控制台配置） ----------
    envRead: async () => ({
      path: '（Web 部署）Vercel 项目 → Settings → Environment Variables（WALLMUSE_*）',
      exists: false, text: '',
    }),
    envWrite: async () => ({ ok: false, error: 'Web 部署请在 Vercel 控制台配置 WALLMUSE_* 环境变量' }),
    envReset: async () => ({ ok: false, error: 'Web 部署请在 Vercel 控制台配置 WALLMUSE_* 环境变量' }),
  };
}
