// 图库存储 — userData/library.json（原子写入）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXT_OK = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

// 源/接口与敏感配置键 — 只存 数据目录/.env，不写 library.json（避免随图库/备份泄露）
const ENV_KEYS = ['aiPresets', 'aiActive', 'cmsApis', 'musicApis', 'customSources', 'builtinSources', 'randomChains', 'endpoints'];

// 轻量 JSON 持久化（原子写，避免 electron-store 的 ESM 兼容问题）
class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = defaults;
    try {
      if (fs.existsSync(file)) this.data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch { /* 损坏时回退默认值 */ }
    this._save();
  }
  _save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  get(key) { return this.data[key]; }
  set(key, val) { this.data[key] = val; this._save(); }
}

class Library {
  constructor(userDataDir, envFile = null) {
    this.dir = path.join(userDataDir, 'library');
    fs.mkdirSync(this.dir, { recursive: true });
    this.envFile = envFile; // { getAll(), set(patch) } — 敏感/源配置的持久化载体
    const defaultSettings = {
      theme: 'dark',
      autoRotate: false,
      rotateMinutes: 30,
      rotateFilter: {},
      // AI 生图：多模型预设（兼容旧版单配置字段）
      aiPresets: [], // [{ name, baseUrl, apiKey, model }]
      aiActive: 0,
      aiBaseUrl: '',
      aiApiKey: '',
      aiModel: '',
      // AI 对话：多模型预设（同一预设结构）
      chatPresets: [], // [{ name, baseUrl, apiKey, model }]
      chatActive: 0,
      // 用户自定义接口内容源 { image:[], text:[], video:[] }，条目 { id, name, url, kind, target }
      customSources: { image: [], text: [], video: [] },
      // 导入的内置内容源（与 customSources 同构，wallmuse-config 导入）
      builtinSources: { image: [], text: [], video: [] },
      // 随机壁纸端点链 { desktop:[{name,url}], mobile:[{name,url}] }
      randomChains: { desktop: [], mobile: [] },
      // 功能性接口 { wallhaven, bing:[], netease }
      endpoints: {},
      // 自定义 CMS / 音乐源（存 .env）
      cmsApis: [],
      musicApis: [],
    };
    this.store = new JsonStore(path.join(userDataDir, 'library.json'), {
      items: [],
      settings: defaultSettings,
    });
    // 深层回填：旧版本 settings 里新增键（如 aiPresets）不被整体覆盖丢失
    this.settings = { ...defaultSettings, ...(this.store.get('settings') || {}) };
    if (this.settings.aiPresets == null) this.settings.aiPresets = [];
    if (this.settings.chatPresets == null) this.settings.chatPresets = [];
    this.settings.customSources = {
      image: [], text: [], video: [], ...(this.settings.customSources || {}),
    };
    this.store.set('settings', this.settings);
    // 迁移：旧版单配置 → 预设列表
    if ((!this.settings.aiPresets || !this.settings.aiPresets.length) && this.settings.aiModel) {
      this.settings.aiPresets = [{
        name: this.settings.aiModel,
        baseUrl: this.settings.aiBaseUrl,
        apiKey: this.settings.aiApiKey,
        model: this.settings.aiModel,
      }];
      this.settings.aiActive = 0;
    }
    // 迁移：旧版对话独立预设（chatPresets）并入全局 AI（对话/生图/小说共用）
    if ((!this.settings.aiPresets || !this.settings.aiPresets.length)
        && Array.isArray(this.settings.chatPresets) && this.settings.chatPresets.length) {
      this.settings.aiPresets = JSON.parse(JSON.stringify(this.settings.chatPresets.filter((p) => p && p.baseUrl && p.model)));
      this.settings.aiActive = 0;
    }
    // 敏感键从 library.json 剥离（改由 .env 管理），内存值保留待 env 回载覆盖
    this._persistSettings();
    this._loadEnvValues();
  }

  /** settings 持久化：剥离 ENV_KEYS（敏感信息只存 .env） */
  _persistSettings() {
    const stored = { ...this.settings };
    for (const k of ENV_KEYS) delete stored[k];
    this.store.set('settings', stored);
  }

  /** 启动时从 .env 回载敏感/源配置（仅内存） */
  _loadEnvValues() {
    if (!this.envFile) return;
    const values = {};
    for (const [k, v] of Object.entries(this.envFile.getAll())) {
      if (!ENV_KEYS.includes(k)) continue;
      try { values[k] = JSON.parse(v); } catch { values[k] = v; }
    }
    this.applyEnvValues(values);
  }

  /** 把 ENV_KEYS 写入 .env（JSON 序列化，便于原样回载） */
  _saveEnvValues() {
    if (!this.envFile) return;
    const patch = {};
    for (const k of ENV_KEYS) {
      if (this.settings[k] !== undefined) patch[k] = JSON.stringify(this.settings[k] ?? null);
    }
    this.envFile.set(patch);
  }

  /** 供 main.js 注入 .env 解析出的敏感配置（仅内存） */
  applyEnvValues(values) {
    Object.assign(this.settings, values);
  }

  /** 解析要使用的 AI 预设配置 */
  resolveAiCfg(presetIndex = null) {
    const s = this.settings;
    const idx = presetIndex == null ? (s.aiActive || 0) : Number(presetIndex);
    const p = (s.aiPresets || [])[idx];
    if (p && p.baseUrl && p.model) return { baseUrl: p.baseUrl, apiKey: p.apiKey || '', model: p.model };
    // 旧字段兜底
    return { baseUrl: s.aiBaseUrl, apiKey: s.aiApiKey, model: s.aiModel };
  }

  /** 解析要使用的对话预设配置 */
  resolveChatCfg(presetIndex = null) {
    const s = this.settings;
    const idx = presetIndex == null ? (s.chatActive || 0) : Number(presetIndex);
    const p = (s.chatPresets || [])[idx];
    if (!p) return { baseUrl: '', apiKey: '', model: '' };
    return { baseUrl: p.baseUrl, apiKey: p.apiKey || '', model: p.model };
  }

  // 对话记录持久化（library.json 的 chats 键，随数据目录一起迁移）
  getChats() { return this.store.get('chats') || []; }
  setChats(list) { this.store.set('chats', Array.isArray(list) ? list.slice(-400) : []); }

  // 小说存档（library.json 的 novels 键，随数据目录一起迁移）
  getNovels() { return this.store.get('novels') || []; }
  setNovels(list) { this.store.set('novels', Array.isArray(list) ? list : []); }

  updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this._persistSettings();
    this._saveEnvValues();
  }

  items() { return this.store.get('items'); }
  list() { return this.items(); }
  get(id) { return this.items().find((i) => i.id === id); }

  isTracked(p) {
    const np = path.normalize(p);
    return this.items().some((i) => i.path === np);
  }

  addFiles(paths, source, extra = {}) {
    const items = this.items();
    // 厸重：同时比对副本路径与原始路径
    const known = new Set(items.flatMap((i) => [i.path, i.originalPath]));
    let added = 0;
    for (const p of paths || []) {
      try {
        const ext = path.extname(p).toLowerCase();
        if (!EXT_OK.has(ext) || !fs.existsSync(p)) continue;
        const np = path.normalize(p);
        if (known.has(np)) continue;
        // 复制入库，保证原图移动/删除后壁纸库仍完整
        const id = crypto.randomUUID();
        const dest = path.join(this.dir, id + ext);
        fs.copyFileSync(np, dest);
        const stat = fs.statSync(dest);
        items.push({
          id,
          path: dest,
          originalPath: np,
          name: extra.name || path.basename(np, ext),
          source, // import | download | ai
          prompt: extra.prompt || '',
          sourceId: extra.sourceId || '',
          sourceUrl: extra.sourceUrl || '',
          tags: [],
          favorite: false,
          collections: [],
          size: stat.size,
          addedAt: Date.now(),
          appliedAt: 0,
        });
        known.add(np);
        added++;
      } catch { /* skip bad file */ }
    }
    this.store.set('items', items);
    return { added };
  }

  _mutate(id, fn) {
    const items = this.items();
    const it = items.find((i) => i.id === id);
    if (!it) return null;
    fn(it);
    this.store.set('items', items);
    return it;
  }

  toggleFav(id) { return this._mutate(id, (it) => { it.favorite = !it.favorite; }); }

  addTag(id, tag) {
    tag = String(tag || '').trim();
    if (!tag) return null;
    return this._mutate(id, (it) => { if (!it.tags.includes(tag)) it.tags.push(tag); });
  }

  removeTag(id, tag) { return this._mutate(id, (it) => { it.tags = it.tags.filter((t) => t !== tag); }); }

  addToCollection(id, name) {
    name = String(name || '').trim();
    if (!name) return null;
    return this._mutate(id, (it) => { if (!it.collections.includes(name)) it.collections.push(name); });
  }

  removeFromCollection(id, name) {
    return this._mutate(id, (it) => { it.collections = it.collections.filter((c) => c !== name); });
  }

  remove(id) {
    const items = this.items().filter((i) => i.id !== id);
    this.store.set('items', items);
  }

  markApplied(id) { return this._mutate(id, (it) => { it.appliedAt = Date.now(); }); }

  pickRandom(filter = {}) {
    let pool = this.items();
    if (filter.favorite) pool = pool.filter((i) => i.favorite);
    if (filter.collection) pool = pool.filter((i) => i.collections.includes(filter.collection));
    if (filter.source) pool = pool.filter((i) => i.source === filter.source);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

module.exports = Library;
