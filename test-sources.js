// 启动应用、隔离 userData、验证 接口源/CMS/存储/对话 全链路 — 无头回归测试
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'wf-src-checks.json');
app.setPath('userData', path.join(__dirname, '.test-userdata')); // 隔离，不污染真实图库
require('./electron/main.js');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 820, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'electron/preload.js'),
      contextIsolation: false, sandbox: false,
    },
  });
  await win.loadFile(path.join(__dirname, 'dist/index.html'));
  await new Promise((r) => setTimeout(r, 1500));
  // 种子：导入内置源配置包（全新隔离 userData 无任何源，不导入会误报）
  const seedFile = path.join(__dirname, 'wallmuse-sources.json');
  if (fs.existsSync(seedFile)) {
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    await win.webContents.executeJavaScript(`window.wallmuse.setSettings(${JSON.stringify(seed.settings || seed)})`);
    await new Promise((r) => setTimeout(r, 800));
  }
  const checks = await win.webContents.executeJavaScript(`(async () => {
    const out = {};
    // 1. 存储状态（首启应未配置）
    out.storage = await window.wallmuse.storageStatus();
    out.storageOk = !!out.storage.dataDir;
    // 2. 接口源列表（内置 图片9/文字13/视频5）
    const srcs = await window.wallmuse.apiSources();
    out.srcImage = srcs.image.length; out.srcText = srcs.text.length; out.srcVideo = srcs.video.length;
    // 3. 接口图片抓取入库（选「电脑壁纸」3 张）
    const imgSrc = srcs.image.find((s) => s.key === 'dnbz') || srcs.image[0];
    const rImg = await window.wallmuse.apiImage({ source: imgSrc, count: 3 });
    out.apiImageOk = rImg.ok && (rImg.items || []).length >= 1;
    out.apiImageCount = rImg.ok ? rImg.items.length : (rImg.error || '');
    // 3b. 混合模式（全部源轮流）
    const rMix = await window.wallmuse.apiImage({ source: { key: '__mix__', name: '混合抓取' }, count: 6 });
    out.apiMixOk = rMix.ok && (rMix.items || []).length >= 2;
    out.apiMixNames = rMix.ok ? [...new Set(rMix.items.map((i) => i.name))].join('/') : (rMix.error || '');
    // 4. 接口文字（毒鸡汤）
    const txtSrc = srcs.text.find((s) => s.key === 'djt') || srcs.text[0];
    const rTxt = await window.wallmuse.apiText({ source: txtSrc });
    out.apiTextOk = rTxt.ok && !!rTxt.text;
    out.apiTextSample = rTxt.ok ? rTxt.text.slice(0, 30) : rTxt.error;
    // 5. 接口视频解析（动漫混剪）
    const vidSrc = srcs.video.find((s) => s.key === 'dm') || srcs.video[0];
    const rVid = await window.wallmuse.apiVideo({ source: vidSrc });
    out.apiVideoOk = rVid.ok && /^https?:/.test(rVid.url || '');
    out.apiVideoUrl = rVid.ok ? rVid.url.slice(0, 60) : rVid.error;
    // 6. CMS 预设 + 搜索
    const presets = await window.wallmuse.cmsPresets();
    out.cmsPresets = presets.length;
    const cms = await window.wallmuse.cmsSearch({ api: presets[0].url, wd: '流浪地球', pg: 1 });
    out.cmsSearchOk = cms.ok && cms.items.length >= 1;
    out.cmsFirst = cms.ok ? cms.items[0]?.name + '(' + cms.items[0]?.plays?.length + '线路,' +
      (cms.items[0].plays[0]?.episodes.length || 0) + '集,' + (cms.items[0].plays[0]?.episodes[0]?.url.includes('.m3u8') ? 'm3u8' : '?') + ')' : cms.error;
    // 7. 对话历史读写
    await window.wallmuse.setChats([{ role: 'user', content: 'ping' }, { role: 'assistant', content: 'pong' }]);
    const hist = await window.wallmuse.getChats();
    out.chatHistory = hist.length === 2;
    // 8. 图库总数增长
    const list = await window.wallmuse.list();
    out.libTotal = list.length;
    return out;
  })()`);
  fs.writeFileSync(OUT, JSON.stringify(checks, null, 2));
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
  app.exit(0);
}).catch((e) => { console.error('TEST FAIL', e); app.exit(1); });
