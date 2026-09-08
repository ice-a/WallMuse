// 注意：必须以 contextIsolation:false 运行（见 main.js）。
// 原因：contextBridge 会在渲染层调用时就对参数做结构化克隆，Vue reactive 的
// Proxy 会直接报 "An object could not be cloned"，preload 内无法拦截。
// 同上下文暴露后，可以在 invoke 之前先把参数净化成纯 JSON，彻底规避。
const { ipcRenderer } = require('electron');

/** 把 Vue reactive/ref 等非纯对象深拷贝为可结构化克隆的纯 JSON */
function plain(v) {
  if (v === undefined) return null;
  if (v && typeof v === 'object') {
    try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
  }
  return v;
}
const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args.map(plain));

window.wallmuse = {
  // 数据存储位置
  storageStatus: () => invoke('storage:status'),
  storagePick: () => invoke('storage:pick'),
  storageUse: (dir) => invoke('storage:use', dir),
  storageMigrate: (dir) => invoke('storage:migrate', dir),
  // 图库
  list: () => invoke('lib:list'),
  import: () => invoke('lib:import'),
  toggleFav: (id) => invoke('lib:toggleFav', id),
  addTag: (id, tag) => invoke('lib:addTag', id, tag),
  removeTag: (id, tag) => invoke('lib:removeTag', id, tag),
  addToCollection: (id, name) => invoke('lib:addToCollection', id, name),
  removeFromCollection: (id, name) => invoke('lib:removeFromCollection', id, name),
  remove: (id) => invoke('lib:remove', id),
  reveal: (id) => invoke('lib:reveal', id),
  // 壁纸
  setWallpaper: (id) => invoke('wp:set', id),
  randomWallpaper: (filter) => invoke('wp:random', filter),
  platform: () => invoke('wp:platform'),
  // Wallhaven
  whSearch: (params) => invoke('wh:search', params),
  whDownload: (wall) => invoke('wh:download', wall),
  // Bing 每日
  bingSearch: (params) => invoke('bing:search', params),
  bingDownload: (wall) => invoke('bing:download', wall),
  // 随机抓取
  randFetch: (params) => invoke('rand:fetch', params),
  // 接口内容源（图片/文字/视频 + 自定义源）
  apiSources: () => invoke('api:sources'),
  apiImage: (params) => invoke('api:image', params),
  apiText: (params) => invoke('api:text', params),
  apiVideo: (params) => invoke('api:video', params),
  apiTest: (src) => invoke('api:test', src),
  // CMS 影视
  cmsPresets: () => invoke('cms:presets'),
  cmsSearch: (params) => invoke('cms:search', params),
  cmsDetail: (params) => invoke('cms:detail', params),
  cmsTest: (api) => invoke('cms:test', api),
  // 音乐（Meting 聚合）
  musicPresets: () => invoke('music:presets'),
  musicSearch: (params) => invoke('music:search', params),
  musicLyrics: (url) => invoke('music:lyrics', url),
  musicTest: (api) => invoke('music:test', api),
  // 小说
  getNovels: () => invoke('novel:get'),
  setNovels: (list) => invoke('novel:set', list),
  // AI 生图
  aiGenerate: (params) => invoke('ai:generate', params),
  aiTest: (cfg) => invoke('ai:test', cfg),
  // AI 对话
  chatModels: (cfg) => invoke('chat:models', cfg),
  chatTest: (cfg) => invoke('chat:test', cfg),
  chatSend: (params) => invoke('chat:send', params),
  getChats: () => invoke('chat:history:get'),
  setChats: (list) => invoke('chat:history:set', list),
  onChatChunk: (cb) => ipcRenderer.on('chat:chunk', (_e, d) => cb(d)),
  // 设置
  getSettings: () => invoke('settings:get'),
  setSettings: (patch) => invoke('settings:set', patch),
  // 配置备份（导出 / 导入 JSON / 从 URL 导入）
  configExport: (opts) => invoke('config:export', opts),
  configImport: () => invoke('config:import'),
  configImportUrl: (url) => invoke('config:importUrl', url),
  // 事件
  onRotated: (cb) => ipcRenderer.on('rotated', (_e, item) => cb(item)),
};
