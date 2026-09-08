// 随机壁纸源 — 多端点降级链抓取
// 端点链由设置提供（wallmuse-config 导入）：{ desktop: [{name,url}...], mobile: [...] }
// 每张图独立走一遍降级链，单个端点挂掉不影响整体
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const EXT_BY_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** 跟随重定向（最多 5 次）下载一张图，返回 { buf, type, source }；失败返回 null */
function downloadWithRedirect(url, timeout, redirectLeft = 5) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'WallMuse/1.0' }, timeout }, (res) => {
      // 302/301/307/308 → 跟随 Location（这些随机图端点都是 302 跳转到图床）
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        res.resume();
        const loc = res.headers.location;
        if (!loc || redirectLeft <= 0) return resolve(null);
        return resolve(downloadWithRedirect(new URL(loc, url).href, timeout, redirectLeft - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const type = (res.headers['content-type'] || '').split(';')[0].trim();
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), type }));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', function () { this.destroy(); resolve(null); });
  });
}

/** 下载一张随机图到 destDir，返回 { file, source }；整条链失败返回 null */
function fetchOne(chain, destDir, timeout = 25000) {
  let attempt = 0;
  const tryNext = () => {
    if (attempt >= chain.length) return Promise.resolve(null);
    const ep = chain[attempt++];
    return downloadWithRedirect(ep.url, timeout).then((r) => {
      if (!r || r.buf.length < 10 * 1024) return tryNext(); // 太小视为坏图
      const ext = EXT_BY_TYPE[r.type] || '.jpg';
      const file = path.join(destDir, `random_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
      fs.writeFileSync(file, r.buf);
      return { file, source: ep.name };
    });
  };
  return tryNext();
}

/**
 * 抓取 count 张随机图
 * @param {object} chains 端点链 { desktop:[{name,url}], mobile:[{name,url}] }
 * @returns { ok, paths, sources, failed, error? }
 */
async function fetchBatch({ kind = 'desktop', count = 12, destDir, chains } = {}) {
  const table = chains && typeof chains === 'object' ? chains : {};
  const chain = table[kind] || table.desktop || [];
  if (!chain.length) return { ok: false, error: '未配置随机壁纸源，请先在设置中导入源配置' };
  fs.mkdirSync(destDir, { recursive: true });
  const n = Math.min(Math.max(1, count), 24);
  // 并发抓取，每个任务独立降级
  const results = await Promise.all(Array.from({ length: n }, () => fetchOne(chain, destDir)));
  const seen = new Set();
  const paths = [];
  const sources = new Set();
  let failed = 0;
  for (const r of results) {
    if (!r) { failed++; continue; }
    const hash = crypto.createHash('md5').update(fs.readFileSync(r.file)).digest('hex');
    if (seen.has(hash)) { try { fs.unlinkSync(r.file); } catch {} continue; } // 随机重复，去重
    seen.add(hash);
    paths.push(r.file);
    sources.add(r.source);
  }
  if (!paths.length) {
    return { ok: false, error: '所有随机源均不可达，请检查网络或更换源配置' };
  }
  return { ok: true, paths, sources: [...sources], failed };
}

module.exports = { fetchBatch };
