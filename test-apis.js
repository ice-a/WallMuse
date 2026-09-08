// 实测 api接口/ 里候选接口的可用性 — 输出 api-report.json
// 图片要求 image/* 且 >10KB；视频要求 video/* 或 JSON 内含 .mp4/.url；文字要求 JSON 能取到目标字段
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WallMuse/1.0';

// 从 api接口/*.md 里挑选的、适合壁纸应用的候选（去掉了擦边/低质源）
const CANDIDATES = [
  // ---- 图片（壁纸向） ----
  { group: 'image', key: 'hd',       name: '横屏壁纸',   url: 'https://api.fw1028.top/hd.php?return=img' },
  { group: 'image', key: 'phone',    name: '竖屏壁纸',   url: 'https://api.fw1028.top/phone.php?return=img' },
  { group: 'image', key: 'bing-fw',  name: '必应壁纸',   url: 'https://api.fw1028.top/bing.php?return=img' },
  { group: 'image', key: 'scenery',  name: '风景',       url: 'https://api.fw1028.top/scenery.php?return=img' },
  { group: 'image', key: 'acg',      name: '动漫',       url: 'https://api.fw1028.top/acg.php?return=img' },
  { group: 'image', key: 'game',     name: '游戏壁纸',   url: 'https://api.fw1028.top/game_wallpaper.php?return=img' },
  { group: 'image', key: 'heal',     name: '小清新',     url: 'https://api.fw1028.top/heal.php?return=img' },
  { group: 'image', key: 'choosen',  name: '精选',       url: 'https://api.fw1028.top/choosen.php?return=img' },
  { group: 'image', key: 'car',      name: '跑车',       url: 'https://api.fw1028.top/car.php?return=img' },
  { group: 'image', key: 'dnbz',     name: '电脑壁纸',   url: 'https://api.yuafeng.cn/API/dnbz/api.php' },
  { group: 'image', key: 'bz-tdz',   name: '高清壁纸',   url: 'https://api.tangdouz.com/abz/bz.php' },
  { group: 'image', key: 'fj4k',     name: '风景4K',     url: 'http://api.xingchenfu.xyz/API/cgq4kjsdt.php' },
  { group: 'image', key: 'ecy',      name: '二次元',     url: 'http://api.xingchenfu.xyz/API/ecy.php' },
  { group: 'image', key: 'cat',      name: '猫猫',       url: 'http://api.xingchenfu.xyz/API/sjmm.php' },
  { group: 'image', key: 'ys',       name: '原神',       url: 'https://api.xingzhige.com/API/yshl/' },
  { group: 'image', key: 'animal',   name: '小动物',     url: 'https://api.pearktrue.cn/api/animal/?type=image&anime=dog' },
  { group: 'image', key: 'bing-wqw', name: '必应归档',   url: 'https://free.wqwlkj.cn/wqwlapi/bing.php', json: 'img' },
  // ---- 文字（一言/语录） ----
  { group: 'text', key: 'djt',    name: '毒鸡汤', url: 'https://api.yuafeng.cn/API/ly/djt.php', json: 'Msg' },
  { group: 'text', key: 'gushi',  name: '古诗',   url: 'https://api.yuafeng.cn/API/ly/gushi.php', json: 'Msg' },
  { group: 'text', key: 'qh',     name: '情话',   url: 'https://api.yuafeng.cn/API/ly/twqh.php', json: 'Msg' },
  { group: 'text', key: 'xh',     name: '笑话',   url: 'https://api.yuafeng.cn/API/ly/xiaohua.php', json: 'Msg' },
  { group: 'text', key: 'rs',     name: '人生',   url: 'https://api.yuafeng.cn/API/ly/rensheng.php', json: 'Msg' },
  { group: 'text', key: 'wr',     name: '温柔',   url: 'https://api.yuafeng.cn/API/ly/wenrou.php', json: 'Msg' },
  { group: 'text', key: 'sg',     name: '伤感',   url: 'https://api.yuafeng.cn/API/ly/shanggan.php', json: 'Msg' },
  { group: 'text', key: 'yh',     name: '英汉互译', url: 'https://api.yuafeng.cn/API/ly/yhyl.php', json: 'Msg' },
  { group: 'text', key: 'dmyy',   name: '动漫一言', url: 'https://api.lolimi.cn/API/dmyiyan/api.php', json: 'text' },
  { group: 'text', key: 'dz',     name: '段子',   url: 'https://api.lolimi.cn/API/yiyan/dz.php' },
  { group: 'text', key: 'poet',   name: '随机诗词', url: 'https://api.tangdouz.com/a/poetrand.php' },
  { group: 'text', key: 'jt',     name: '鸡汤',   url: 'https://api.tangdouz.com/a/jt.php' },
  { group: 'text', key: 'food',   name: '今天吃什么', url: 'https://api.pearktrue.cn/api/today/food.php', json: 'food' },
  { group: 'text', key: 'tg',     name: '舔狗日记', url: 'https://free.wqwlkj.cn/wqwlapi/tiangou.php', json: 'msg' },
  // ---- 视频（短视频） ----
  { group: 'video', key: 'dm',   name: '动漫',   url: 'https://api.yuafeng.cn/API/ly/dmxl.php' },
  { group: 'video', key: 'zy',   name: '治愈',   url: 'https://api.yuafeng.cn/API/ly/zyxl.php' },
  { group: 'video', key: 'sgv',  name: '帅哥',   url: 'https://api.yuafeng.cn/API/ly/sgxl.php' },
  { group: 'video', key: 'emo',  name: 'emo',    url: 'https://api.yuafeng.cn/API/ly/emo.php' },
  { group: 'video', key: 'mh',   name: '漫画混剪', url: 'https://api.yuafeng.cn/API/ly/mhy.php' },
  { group: 'video', key: 'jm',   name: '久喵',   url: 'https://api.317ak.com/API/sp/jmxl.php', json: 'data' },
  { group: 'video', key: 'xtm',  name: '仙桃猫', url: 'https://api.317ak.com/API/sp/xtmx.php', json: 'data' },
  { group: 'video', key: 'cos',  name: 'COS',   url: 'https://api.317ak.com/API/sp/cosxl.php' },
  { group: 'video', key: 'qt',   name: '晴天',   url: 'https://api.317ak.com/API/sp/qttj.php' },
  { group: 'video', key: 'yz',   name: '余震',   url: 'https://api.317ak.com/API/sp/yzxl.php' },
  { group: 'video', key: 'dmbz', name: '动漫变装', url: 'https://api.317ak.com/API/sp/dmbz.php' },
  { group: 'video', key: 'ysv',  name: '原神',   url: 'https://api.317ak.com/API/sp/yssp.php' },
  { group: 'video', key: 'gjbz', name: '光剑变装', url: 'https://api.317ak.com/API/sp/gjbz.php' },
  { group: 'video', key: 'mw',   name: '萌娃',   url: 'https://api.317ak.com/API/sp/mwxl.php' },
];

async function probe(c) {
  const out = { ...c, ok: false, how: '', detail: '' };
  try {
    const res = await fetch(c.url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    out.status = res.status;
    out.finalUrl = res.url;
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
    out.contentType = ct;
    if (c.group === 'image') {
      if (ct.startsWith('image/')) {
        const buf = Buffer.from(await res.arrayBuffer());
        out.bytes = buf.length;
        if (buf.length > 10 * 1024) { out.ok = true; out.how = 'direct'; }
        else out.detail = `图片太小 ${buf.length}B`;
      } else {
        // 可能返回 JSON 带 URL
        const txt = (await res.text()).slice(0, 500);
        out.detail = `非图片响应: ${txt.replace(/\s+/g, ' ').slice(0, 160)}`;
        try {
          const j = JSON.parse(txt);
          const u = findUrl(j);
          if (u) {
            const r2 = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
            const ct2 = (r2.headers.get('content-type') || '');
            const b2 = Buffer.from(await r2.arrayBuffer());
            if (ct2.includes('image') && b2.length > 10 * 1024) { out.ok = true; out.how = `json→${u.slice(0, 60)}`; out.bytes = b2.length; }
          }
        } catch {}
      }
    } else if (c.group === 'video') {
      if (ct.startsWith('video/')) {
        const buf = Buffer.from(await res.arrayBuffer());
        out.bytes = buf.length;
        // 只拉前 256KB 判断即可，但 fetch 已全量；大文件另测
        out.ok = buf.length > 100 * 1024 || ct.includes('mp4');
        out.how = 'direct-302';
        if (!out.ok) out.detail = `video 响应仅 ${buf.length}B`;
      } else {
        const txt = await res.text();
        out.detail = txt.replace(/\s+/g, ' ').slice(0, 220);
        try {
          const j = JSON.parse(txt);
          const u = findVideoUrl(j);
          if (u) {
            const r2 = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(12000) });
            const ct2 = (r2.headers.get('content-type') || '');
            out.how = `json(${u.slice(0, 70)})→${r2.status} ${ct2}`;
            out.ok = r2.status === 200 && (ct2.startsWith('video/') || ct2.includes('octet-stream') || ct2.includes('mp4'));
            if (!out.ok) {
              // 有些 HEAD 不支持，用 GET 前 64KB 试
              const r3 = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
              const reader = r3.body.getReader();
              const { value } = await reader.read();
              await reader.cancel();
              const head = Buffer.from(value || []).slice(0, 16);
              out.ok = head.length >= 12 && head.slice(4, 8).toString() === 'ftyp';
              out.how += ` | GET:${r3.status} mp4magic=${out.ok}`;
            }
          } else out.detail += ' [json 内未找到视频 URL]';
        } catch { /* 保持纯文本 detail */ }
      }
    } else { // text
      const txt = (await res.text()).trim();
      out.raw = txt.replace(/\s+/g, ' ').slice(0, 120);
      if (c.json) {
        try {
          const j = JSON.parse(txt);
          const v = deepGet(j, c.json);
          if (v && String(v).trim()) { out.ok = true; out.how = `json:${c.json}`; out.sample = String(v).slice(0, 60); }
          else out.detail = `JSON 无字段 ${c.json}`;
        } catch { out.detail = '非 JSON'; }
      } else if (txt && txt.length < 800 && !txt.startsWith('<')) {
        out.ok = true; out.how = 'plain'; out.sample = txt.slice(0, 60);
      } else out.detail = '响应过长或为 HTML';
    }
  } catch (e) {
    out.detail = String(e.message || e).slice(0, 160);
  }
  return out;
}

function deepGet(o, path) {
  let cur = o;
  for (const k of path.split('.')) {
    if (cur == null) return undefined;
    if (k.endsWith('[]')) { cur = cur[k.slice(0, -2)]; cur = Array.isArray(cur) ? cur[0] : cur; }
    else cur = cur[k];
  }
  return cur;
}

function findUrl(j, depth = 0) {
  if (depth > 4 || j == null) return null;
  if (typeof j === 'string') return /^https?:\/\/\S+\.(jpg|jpeg|png|webp|gif)/i.test(j) ? j : null;
  if (Array.isArray(j)) { for (const v of j) { const r = findUrl(v, depth + 1); if (r) return r; } return null; }
  if (typeof j === 'object') { for (const v of Object.values(j)) { const r = findUrl(v, depth + 1); if (r) return r; } }
  return null;
}

function findVideoUrl(j, depth = 0) {
  if (depth > 4 || j == null) return null;
  if (typeof j === 'string') return /^https?:\/\/\S+\.(mp4|mov|m4v)/i.test(j) || /^https?:\/\/\S*(video|sp|douyin|kuaishou)\S*\.(mp4|mov)/i.test(j) ? j : null;
  if (Array.isArray(j)) { for (const v of j) { const r = findVideoUrl(v, depth + 1); if (r) return r; } return null; }
  if (typeof j === 'object') { for (const v of Object.values(j)) { const r = findVideoUrl(v, depth + 1); if (r) return r; } }
  return null;
}

(async () => {
  const results = [];
  const CONC = 8;
  for (let i = 0; i < CANDIDATES.length; i += CONC) {
    results.push(...await Promise.all(CANDIDATES.slice(i, i + CONC).map(probe)));
    process.stdout.write(`已测 ${Math.min(i + CONC, CANDIDATES.length)}/${CANDIDATES.length}\n`);
  }
  const report = { testedAt: new Date().toISOString(), results };
  fs.writeFileSync(__dirname + '/api-report.json', JSON.stringify(report, null, 2));
  for (const g of ['image', 'text', 'video']) {
    console.log(`\n===== ${g} =====`);
    for (const r of results.filter((x) => x.group === g)) {
      console.log(`${r.ok ? '✓' : '✗'} [${r.key}] ${r.name}  ${r.ok ? r.how : ''}${r.detail ? '  | ' + r.detail : ''}`);
    }
  }
  const okN = results.filter((r) => r.ok).length;
  console.log(`\n可用 ${okN}/${results.length}`);
})();
