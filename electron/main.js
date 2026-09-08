// WallMuse — 跨平台壁纸管理器 主进程
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const Library = require('./library');
const wallpaper = require('./wallpaper');
const wallhaven = require('./wallhaven');
const bing = require('./bing');
const randomsrc = require('./randomsrc');
const ai = require('./ai');
const apisrc = require('./apisrc');
const chat = require('./chat');
const cms = require('./cms');
const music = require('./music');
const { Storage } = require('./storage');
const { EnvFile } = require('./env');

const isDev = !app.isPackaged;

let win = null;
let lib = null;
let storage = null;
let rotateTimer = null;

// ---------- 自定义协议：安全地提供本地图片 ----------
function registerMediaProtocol() {
  protocol.handle('media', (request) => {
    let p = decodeURIComponent(new URL(request.url).pathname);
    if (process.platform === 'win32') p = p.slice(1); // 去掉开头的 /
    p = path.normalize(p);
    if (!lib.isTracked(p)) return new Response('Not found', { status: 404 });
    return net.fetch('file://' + (process.platform === 'win32' ? '/' + p : p));
  });
}

// ---------- m3u8 / 视频分段跨域放行（hls.js 拉流需要） ----------
function relaxMediaCors() {
  const MEDIA_CT = /^(video\/|audio\/|application\/(vnd\.apple\.mpegurl|x-mpegURL|octet-stream|dash\+xml))/i;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const h = { ...details.responseHeaders };
    const ct = (h['content-type'] || h['Content-Type'] || [])[0] || '';
    if (details.resourceType === 'media' || details.resourceType === 'xhr' || MEDIA_CT.test(ct)) {
      h['Access-Control-Allow-Origin'] = ['*'];
      if (details.method !== 'GET') h['Access-Control-Allow-Headers'] = ['*'];
    }
    callback({ responseHeaders: h });
  });
}

function dataDir() { return storage.dataDir; }
function initLibrary() {
  const envFile = new EnvFile(path.join(storage.dataDir, '.env'));
  lib = new Library(storage.dataDir, envFile);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1115',
    title: 'WallMuse',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // contextIsolation 必须关闭：contextBridge 的边界克隆不支持 Vue reactive 的
      // Proxy 参数（"An object could not be cloned"），需要在同上下文里先净化。
      // nodeIntegration 仍为 false，渲染层拿不到 Node 能力。
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// ---------- IPC ----------
function registerIpc() {
  // 数据存储位置：状态 / 选择 / 首次使用 / 迁移
  ipcMain.handle('storage:status', () => storage.status());
  ipcMain.handle('storage:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择数据存储位置',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    return { canceled: false, dir: r.filePaths[0] };
  });
  ipcMain.handle('storage:use', (_e, dir) => {
    const r = storage.useDir(dir);
    if (r.ok) initLibrary();
    return { ...r, status: storage.status() };
  });
  ipcMain.handle('storage:migrate', (_e, dir) => {
    const r = storage.migrate(dir);
    if (r.ok) initLibrary();
    return r;
  });

  // 图库
  ipcMain.handle('lib:list', () => lib.list());
  ipcMain.handle('lib:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '导入图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (r.canceled) return { added: 0 };
    return lib.addFiles(r.filePaths, 'import');
  });
  ipcMain.handle('lib:toggleFav', (_e, id) => lib.toggleFav(id));
  ipcMain.handle('lib:addTag', (_e, id, tag) => lib.addTag(id, tag));
  ipcMain.handle('lib:removeTag', (_e, id, tag) => lib.removeTag(id, tag));
  ipcMain.handle('lib:addToCollection', (_e, id, name) => lib.addToCollection(id, name));
  ipcMain.handle('lib:removeFromCollection', (_e, id, name) => lib.removeFromCollection(id, name));
  ipcMain.handle('lib:remove', async (_e, id) => {
    const item = lib.get(id);
    if (!item) return false;
    await shell.trashItem(item.path).catch(() => {});
    lib.remove(id);
    return true;
  });
  ipcMain.handle('lib:reveal', (_e, id) => { const it = lib.get(id); if (it) shell.showItemInFolder(it.path); });

  // 壁纸
  ipcMain.handle('wp:set', async (_e, id) => {
    const item = lib.get(id);
    if (!item) return { ok: false, error: 'not found' };
    const r = await wallpaper.set(item.path);
    if (r.ok) lib.markApplied(id);
    return r;
  });
  ipcMain.handle('wp:random', async (_e, filter) => {
    const item = lib.pickRandom(filter);
    if (!item) return { ok: false, error: 'empty' };
    const r = await wallpaper.set(item.path);
    if (r.ok) lib.markApplied(item.id);
    return { ...r, item };
  });
  ipcMain.handle('wp:platform', () => ({ platform: process.platform, backend: wallpaper.backendName() }));

  // Wallhaven（接口地址由设置提供）
  ipcMain.handle('wh:search', (_e, params) => wallhaven.search(params, lib.settings.endpoints?.wallhaven));
  ipcMain.handle('wh:download', async (_e, wall) => {
    const r = await wallhaven.download(wall, path.join(dataDir(), 'downloads'));
    if (r.ok) lib.addFiles([r.path], 'download', { sourceId: wall.id, sourceUrl: wall.url, name: wall.id });
    return r;
  });

  // Bing 每日壁纸（域名列表由设置提供）
  ipcMain.handle('bing:search', (_e, params) => bing.search(params, lib.settings.endpoints?.bing));
  ipcMain.handle('bing:download', async (_e, wall) => {
    const r = await bing.download(wall, path.join(dataDir(), 'downloads'));
    if (r.ok) lib.addFiles([r.path], 'download', { sourceId: wall.id, sourceUrl: wall.url, name: wall.name || wall.id });
    return r;
  });

  // 随机壁纸抓取（端点链由设置提供，直接入库）
  ipcMain.handle('rand:fetch', async (_e, params) => {
    const r = await randomsrc.fetchBatch({
      ...params, destDir: path.join(dataDir(), 'downloads'),
      chains: lib.settings.randomChains,
    });
    if (r.ok && r.paths.length) {
      const before = new Set(lib.items().map((i) => i.id));
      for (const p of r.paths) lib.addFiles([p], 'download', { name: '随机壁纸' });
      r.items = lib.items().filter((i) => !before.has(i.id));
    }
    return r;
  });

  // 接口内容源（图片入库 / 文字 / 视频 / 自定义源测试）— 源列表全部来自设置
  ipcMain.handle('api:sources', () => apisrc.listSources(lib.settings.builtinSources || {}, lib.settings.customSources || {}));
  ipcMain.handle('api:image', async (_e, { source, count }) => {
    // key=__mix__ 为混合模式：全部源（导入源 + 自定义源）轮流抓取
    const all = apisrc.listSources(lib.settings.builtinSources || {}, lib.settings.customSources || {});
    const sources = source.key === '__mix__' ? all.image : [source];
    const r = await apisrc.fetchImageBatch({
      sources, count, destDir: path.join(dataDir(), 'downloads'),
    });
    if (r.ok && r.paths.length) {
      const before = new Set(lib.items().map((i) => i.id));
      r.paths.forEach((p, i) => lib.addFiles([p], 'download', { name: r.names[i] || source.name || '接口图片' }));
      r.items = lib.items().filter((i) => !before.has(i.id));
    }
    return r;
  });
  ipcMain.handle('api:text', (_e, { source }) => apisrc.fetchText(source));
  ipcMain.handle('api:video', (_e, { source }) => apisrc.resolveVideo(source));
  ipcMain.handle('api:test', (_e, src) => apisrc.testSource(src));

  // CMS 影视资源（接口列表由设置提供）
  ipcMain.handle('cms:presets', () => [...cms.presets(), ...(lib.settings.cmsApis || [])]);
  ipcMain.handle('cms:search', (_e, params) => cms.search(params));
  ipcMain.handle('cms:detail', (_e, params) => cms.detail(params));
  ipcMain.handle('cms:test', (_e, api) => cms.test(api));

  // 音乐（网易云直连 + Meting 聚合，接口列表/域名由设置提供）
  ipcMain.handle('music:presets', () => lib.settings.musicApis || []);
  ipcMain.handle('music:search', (_e, params) => music.search({ ...params, neteaseBase: lib.settings.endpoints?.netease }));
  ipcMain.handle('music:lyrics', (_e, url) => music.lyrics(url, lib.settings.endpoints?.netease));
  ipcMain.handle('music:test', (_e, api) => music.test(api));

  // 小说
  ipcMain.handle('novel:get', () => lib.getNovels());
  ipcMain.handle('novel:set', (_e, list) => lib.setNovels(list));

  // AI 生图（OpenAI 兼容接口，支持多模型预设）
  ipcMain.handle('ai:generate', async (_e, { prompt, size, presetIndex }) => {
    const cfg = lib.resolveAiCfg(presetIndex);
    if (!cfg.baseUrl || !cfg.model) {
      return { ok: false, error: '未配置 AI 接口，请先在设置中添加模型预设（Base URL / API Key / 模型）' };
    }
    const r = await ai.generate({
      ...cfg,
      prompt: String(prompt || ''), size: size || '1024x1024',
    });
    if (r.ok) {
      const dir = path.join(dataDir(), 'generated');
      const saved = ai.saveImage(r, dir, prompt);
      if (saved) {
        lib.addFiles([saved], 'ai', { name: (prompt || 'ai').slice(0, 40), prompt });
        return { ok: true, path: saved };
      }
      return { ok: false, error: '图片保存失败' };
    }
    return r;
  });
  ipcMain.handle('ai:test', async (_e, cfg) => ai.test(cfg));

  // AI 对话（OpenAI 兼容：拉模型列表 / 测试 / 流式对话）
  ipcMain.handle('chat:models', (_e, cfg) => chat.listModels(cfg));
  ipcMain.handle('chat:test', (_e, cfg) => chat.test(cfg));
  ipcMain.handle('chat:send', async (_e, { presetIndex, messages, system }) => {
    const cfg = lib.resolveChatCfg(presetIndex);
    if (!cfg.baseUrl || !cfg.model) {
      return { ok: false, error: '未配置对话模型，请先在对话页填写 Base URL / API Key 并选择模型' };
    }
    // Agent 人设：system 提示词置于消息序列最前
    const sys = String(system || '').trim();
    const full = sys ? [{ role: 'system', content: sys }, ...messages] : messages;
    const reqId = Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    const r = await chat.chatStream({ ...cfg, messages: full }, (delta) => {
      win?.webContents.send('chat:chunk', { reqId, delta });
    });
    return { ...r, reqId };
  });
  ipcMain.handle('chat:history:get', () => lib.getChats());
  ipcMain.handle('chat:history:set', (_e, list) => lib.setChats(list));

  // 设置
  ipcMain.handle('settings:get', () => lib.settings);
  ipcMain.handle('settings:set', (_e, patch) => {
    lib.updateSettings(patch);
    applyRotateSchedule();
    return lib.settings;
  });

  // ---------- 配置备份（导出 / 导入 JSON / 从 URL 导入） ----------
  // 可备份的配置键（白名单，不包含图库/对话记录等运行数据）
  const CONFIG_KEYS = [
    'theme', 'autoRotate', 'rotateMinutes', 'rotateFilter',
    'aiPresets', 'aiActive', 'aiBaseUrl', 'aiApiKey', 'aiModel',
    'chatPresets', 'chatActive', 'chatAgents', 'chatAgent',
    'customSources', 'builtinSources', 'randomChains', 'endpoints',
    'cmsApis', 'musicApis',
  ];

  /** 白名单过滤 + 逐键类型校验（URL 键要求 http(s) 格式），返回实际生效的配置 */
  function sanitizeConfig(raw) {
    const cfg = {};
    for (const k of CONFIG_KEYS) {
      const v = raw[k];
      if (v === undefined) continue;
      if (['aiPresets', 'chatPresets', 'chatAgents', 'cmsApis', 'musicApis'].includes(k)) {
        if (!Array.isArray(v)) continue;
        cfg[k] = v.filter((x) => x && typeof x === 'object');
      } else if (['customSources', 'builtinSources'].includes(k)) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
        cfg[k] = { image: [], text: [], video: [] };
        for (const g of ['image', 'text', 'video']) {
          cfg[k][g] = (Array.isArray(v[g]) ? v[g] : [])
            .filter((x) => x && typeof x === 'object' && typeof x.url === 'string' && /^https?:\/\//i.test(x.url));
        }
      } else if (k === 'randomChains') {
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
        cfg[k] = {};
        for (const g of ['desktop', 'mobile']) {
          cfg[k][g] = (Array.isArray(v[g]) ? v[g] : [])
            .filter((x) => x && typeof x === 'object' && typeof x.url === 'string' && /^https?:\/\//i.test(x.url));
        }
      } else if (k === 'endpoints') {
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
        cfg[k] = {};
        if (typeof v.wallhaven === 'string' && /^https?:\/\//i.test(v.wallhaven)) cfg[k].wallhaven = v.wallhaven.trim();
        if (Array.isArray(v.bing)) cfg[k].bing = v.bing.filter((x) => typeof x === 'string' && /^https?:\/\//i.test(x));
        if (typeof v.netease === 'string' && /^https?:\/\//i.test(v.netease)) cfg[k].netease = v.netease.trim();
        if (!Object.keys(cfg[k]).length) continue;
      } else if (['aiActive', 'chatActive', 'rotateMinutes'].includes(k)) {
        const n = Number(v);
        if (Number.isFinite(n)) cfg[k] = n;
      } else if (k === 'rotateFilter') {
        if (v && typeof v === 'object' && !Array.isArray(v)) cfg[k] = v;
      } else if (['theme', 'chatAgent', 'aiBaseUrl', 'aiApiKey', 'aiModel'].includes(k)) {
        cfg[k] = String(v);
      }
    }
    return cfg;
  }

  /** 组装导出配置；includeKeys=false 时剥掉 API Key，includeSources=false 时剥掉自定义源/接口 */
  function buildConfigExport({ includeKeys = false, includeSources = true } = {}) {
    const s = lib.settings;
    const out = {};
    for (const k of CONFIG_KEYS) {
      if (s[k] !== undefined) out[k] = JSON.parse(JSON.stringify(s[k]));
    }
    if (!includeKeys) {
      for (const p of out.aiPresets || []) delete p.apiKey;
      for (const p of out.chatPresets || []) delete p.apiKey;
      delete out.aiApiKey;
    }
    if (!includeSources) {
      delete out.customSources;
      delete out.cmsApis;
      delete out.musicApis;
    }
    return out;
  }

  function summarizeConfig(cfg) {
    const parts = [];
    if (cfg.aiPresets) parts.push(`生图预设 ${cfg.aiPresets.length}`);
    if (cfg.chatPresets) parts.push(`对话预设 ${cfg.chatPresets.length}`);
    if (cfg.chatAgents) parts.push(`Agent ${cfg.chatAgents.length}`);
    const srcCount = (o) => ['image', 'text', 'video'].reduce((n, g) => n + ((o && o[g]) || []).length, 0);
    if (cfg.builtinSources && srcCount(cfg.builtinSources)) parts.push(`内容源 ${srcCount(cfg.builtinSources)}`);
    if (cfg.customSources && srcCount(cfg.customSources)) parts.push(`自定义源 ${srcCount(cfg.customSources)}`);
    if (cfg.randomChains) {
      const n = (cfg.randomChains.desktop || []).length + (cfg.randomChains.mobile || []).length;
      if (n) parts.push(`随机源 ${n}`);
    }
    if (cfg.cmsApis) parts.push(`影视源 ${cfg.cmsApis.length}`);
    if (cfg.musicApis) parts.push(`音乐源 ${cfg.musicApis.length}`);
    if (cfg.endpoints && Object.keys(cfg.endpoints).length) parts.push(`功能接口 ${Object.keys(cfg.endpoints).length}`);
    return parts.length ? parts.join('、') : '应用偏好设置';
  }

  /** 校验并应用导入的配置对象（文件 / URL 共用） */
  function applyImportedConfig(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: '不是有效的 WallMuse 配置文件' };
    }
    const body = raw.type === 'wallmuse-config' ? raw.settings : raw;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, error: '不是有效的 WallMuse 配置文件' };
    }
    // 白名单过滤 + 基础类型校验
    const cfg = sanitizeConfig(body);
    if (!Object.keys(cfg).length) {
      return { ok: false, error: '配置内容校验未通过：没有识别到有效的配置项（键名或格式不符）' };
    }
    lib.updateSettings(cfg);
    applyRotateSchedule();
    return {
      ok: true,
      summary: summarizeConfig(cfg),
      hasKeys: !!(body.aiApiKey
        || (body.aiPresets || []).some((p) => p.apiKey)
        || (body.chatPresets || []).some((p) => p.apiKey)),
    };
  }

  /** 拉取 URL 配置文本（跟随重定向，限制 2MB，20s 超时） */
  function fetchConfigText(urlStr, depth = 0) {
    return new Promise((resolve, reject) => {
      if (depth > 5) return reject(new Error('重定向次数过多'));
      let u;
      try { u = new URL(urlStr); } catch { return reject(new Error('URL 格式无效')); }
      if (!/^https?:$/.test(u.protocol)) return reject(new Error('仅支持 http(s) 地址'));
      const mod = u.protocol === 'http:' ? http : https;
      const req = mod.get(u, {
        timeout: 20000,
        headers: { 'User-Agent': UA, Accept: 'application/json,*/*' },
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve(fetchConfigText(new URL(res.headers.location, u).href, depth + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}，请检查地址是否可公开访问`));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > 2 * 1024 * 1024) { req.destroy(new Error('响应超过 2MB，不是有效的配置文件')); return; }
          chunks.push(c);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('请求超时')));
    });
  }

  ipcMain.handle('config:export', async (_e, opts) => {
    try {
      const data = {
        app: 'WallMuse', type: 'wallmuse-config', version: 1,
        exportedAt: new Date().toISOString(),
        settings: buildConfigExport(opts || {}),
      };
      const r = await dialog.showSaveDialog(win, {
        title: '导出 WallMuse 配置',
        defaultPath: `wallmuse-config-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON 配置', extensions: ['json'] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf8');
      return { ok: true, path: r.filePath, summary: summarizeConfig(data.settings) };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle('config:import', async (_e) => {
    try {
      const r = await dialog.showOpenDialog(win, {
        title: '导入 WallMuse 配置',
        filters: [{ name: 'JSON 配置', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths.length) return { canceled: true };
      const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      return applyImportedConfig(data);
    } catch (e) {
      return { ok: false, error: '导入失败：' + String(e.message || e) };
    }
  });

  ipcMain.handle('config:importUrl', async (_e, url) => {
    try {
      const text = await fetchConfigText(String(url || '').trim());
      let data;
      try { data = JSON.parse(text); } catch {
        return { ok: false, error: 'URL 内容不是合法 JSON，请确认指向的是 WallMuse 配置文件' };
      }
      return applyImportedConfig(data);
    } catch (e) {
      return { ok: false, error: 'URL 导入失败：' + String(e.message || e) };
    }
  });
}

// ---------- 定时轮换 ----------
function applyRotateSchedule() {
  if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
  const s = lib.settings;
  if (!s.autoRotate || !s.rotateMinutes) return;
  const ms = Math.max(1, Number(s.rotateMinutes)) * 60 * 1000;
  rotateTimer = setInterval(async () => {
    const item = lib.pickRandom(s.rotateFilter || {});
    if (!item) return;
    const r = await wallpaper.set(item.path);
    if (r.ok) { lib.markApplied(item.id); win?.webContents.send('rotated', item); }
  }, ms);
}

app.whenReady().then(() => {
  storage = new Storage(app.getPath('userData')); // 已保存的数据目录（首次启动为默认目录）
  initLibrary();
  registerMediaProtocol();
  relaxMediaCors();
  registerIpc();
  applyRotateSchedule();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { if (rotateTimer) clearInterval(rotateTimer); });
