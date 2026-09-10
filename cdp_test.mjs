// 浏览器自动化冒烟测试：通过 CDP 连接本机 Chrome，加载 Web 版 WallMuse，
// 注入内置源配置（模拟导入），校验新增的 9 个图片源 + tsinbei 音乐源是否生效，
// 并软探一个 604 图片源是否能经应用引擎取到图。
import { readFileSync } from 'node:fs';

const PORT = 9222;
const APP = 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

let failed = false;
let ws = null;
let targetId = null;
try {
  // 开一个全新标签页，避免劫持用户正在用的标签页
  const created = await fetch(`http://localhost:${PORT}/json/new`, { method: 'PUT' });
  if (!created.ok) throw new Error('无法创建测试标签页 HTTP ' + created.status);
  const target = await created.json();
  targetId = target.id;
  if (!target.webSocketDebuggerUrl) throw new Error('新标签页无 webSocketDebuggerUrl');
  ws = new WebSocket(target.webSocketDebuggerUrl);

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const o = JSON.parse(ev.data);
    if (o.method === 'Runtime.exceptionThrown') {
      try { console.log('PAGE EXCEPTION:', JSON.stringify(o.params.exceptionDetails.exception || o.params.exceptionDetails.text)); } catch {}
    }
    if (o.method === 'Runtime.consoleAPICalled') {
      try { console.log('PAGE LOG:', (o.params.args || []).map((a) => a.value ?? a.description).join(' ')); } catch {}
    }
    if (o.id && pending.has(o.id)) {
      const { res, rej } = pending.get(o.id);
      pending.delete(o.id);
      if (o.error) rej(new Error(o.error.message));
      else res(o.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myid = ++id;
    pending.set(myid, { res, rej });
    ws.send(JSON.stringify({ id: myid, method, params }));
  });
  // 把任意含 await 的语句包进 async IIFE，规避 Classic Script 顶层 await 语法错误
  const evalAsync = async (body) => {
    const expression = `(async () => { ${body} })()`;
    return send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  };

  await new Promise((r) => { ws.onopen = r; });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: APP });
  await sleep(9000); // Vite 首次冷编译 SFC 较慢，多等一会

  const diag = await evalAsync('return JSON.stringify({ rs: document.readyState, title: document.title, wm: typeof window.wallmuse, body: (document.body ? document.body.innerHTML : "").slice(0, 160) })');
  let diagVal = {};
  try { diagVal = JSON.parse(diag.result.value); } catch {}
  console.log('diag:', JSON.stringify(diagVal));

  const loaded = await evalAsync('return !!(window.wallmuse && typeof window.wallmuse.apiSources === "function")');
  console.log('app loaded (window.wallmuse.apiSources):', loaded.result.value);
  if (!loaded.result.value) throw new Error('应用未初始化 window.wallmuse');

  // 模拟「导入配置」：把 wallmuse-sources.json 的 settings 整体写入 localStorage
  const full = JSON.parse(readFileSync('wallmuse-sources.json', 'utf8')).settings;
  await evalAsync(`localStorage.setItem('wm.settings', ${JSON.stringify(JSON.stringify(full))}); return 'ok'`);

  // 1) 图片源：新增的 9 个都应出现
  const sourcesRes = await evalAsync('return JSON.stringify(await window.wallmuse.apiSources())');
  const sources = JSON.parse(sourcesRes.result.value);
  const names = ['image', 'text', 'video'].flatMap((g) => (sources[g] || []).map((s) => s.name));
  console.log('total sources after import:', names.length);

  const expectImg = ['604·动漫', '604·美女', '604·自然', '604·随机', '604·壁纸', '604·壁纸美女', '604·壁纸自然', '电脑端动漫', '二次元头像'];
  const missingImg = expectImg.filter((n) => !names.includes(n));
  console.log('expected new image sources present:', expectImg.length - missingImg.length, '/', expectImg.length);
  if (missingImg.length) { console.log('MISSING IMAGE SOURCES:', missingImg); failed = true; }

  // 2) 音乐源：tsinbei 应出现
  const musicRes = await evalAsync('return JSON.stringify(await window.wallmuse.musicPresets())');
  let musicList = [];
  try { musicList = JSON.parse(musicRes.result.value); } catch {}
  const hasTsinbei = musicList.some((m) => (m.name || '').includes('tsinbei') || (m.url || '').includes('tsinbei'));
  console.log('music sources count:', musicList.length, '| tsinbei present:', hasTsinbei);
  if (!hasTsinbei) { console.log('MISSING MUSIC SOURCE: tsinbei'); failed = true; }

  // 3) 软探：用 apiSources() 返回的真实源对象（带 key）经应用引擎取一张图
  const probe = await evalAsync(`return JSON.stringify(await (async () => {
    try {
      const all = await window.wallmuse.apiSources();
      const src = (all.image || []).find((s) => s.name === "604·动漫");
      if (!src) return { ok: false, err: "找不到 604·动漫 源" };
      const r = await window.wallmuse.apiImage({ source: src, count: 1 });
      return { ok: r.ok, n: (r.items || []).length, err: r.error || "" };
    } catch (e) { return { ok: false, err: String(e) }; }
  })())`);
  let probeVal = {};
  try { probeVal = JSON.parse(probe.result.value); } catch {}
  console.log('image fetch via app engine (604·动漫):', JSON.stringify(probeVal));
} catch (e) {
  console.log('TEST ERROR:', e.message);
  failed = true;
} finally {
  if (ws) {
    try { if (targetId) ws.send(JSON.stringify({ id: 9999, method: 'Target.closeTarget', params: { targetId } })); } catch {}
    try { ws.close(); } catch {}
  }
}
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
