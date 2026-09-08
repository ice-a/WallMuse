const m = require('./electron/music.js');
const https = require('https');
const fs = require('fs');
const path = require('path');

// neteaseBase 由配置包提供（与应用内 settings.endpoints.netease 一致）
const seedFile = path.join(__dirname, 'wallmuse-sources.json');
const neteaseBase = fs.existsSync(seedFile)
  ? (JSON.parse(fs.readFileSync(seedFile, 'utf8')).settings?.endpoints?.netease || 'https://music.163.com')
  : 'https://music.163.com';

(async () => {
  const t0 = Date.now();
  const r = await m.search({ api: 'builtin:netease', server: 'netease', wd: '海阔天空', neteaseBase });
  console.log('search ms:', Date.now() - t0, '| ok:', r.ok, '| items:', r.items?.length, '| error:', r.error || '');
  if (!r.ok) process.exit(1);
  for (const t of r.items.slice(0, 5)) console.log(' -', t.name, '|', t.artist, '|', t.url.slice(0, 70));
  // 抽一首真实探测音频流
  const t = r.items[0];
  const http = require('http');
  const mod = t.url.startsWith('https') ? https : http;
  await new Promise((res) => {
    const req = mod.request(new URL(t.url), { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-199' } }, (resp) => {
      console.log('audio probe:', resp.statusCode, resp.headers['content-type'], 'bytes:', resp.headers['content-length']);
      resp.resume(); resp.on('end', res);
    });
    req.on('error', (e) => { console.log('probe ERR', e.message); res(); });
    req.end();
  });
  const l = await m.lyrics(t.lrc, neteaseBase);
  console.log('lyrics ok:', l.ok, '|', (l.text || '').split(/\r?\n/).slice(0, 2).join(' / '));
  // Meting 分支回归（应失败但不崩溃）
  const r2 = await m.search({ api: 'https://api.i-meto.com/meting/api', server: 'kugou', wd: '晴天' });
  console.log('meting branch:', r2.ok ? 'ok ' + r2.items.length : 'fail: ' + r2.error);
  process.exit(0);
})().catch((e) => { console.log('FAIL:', e.message); process.exit(1); });
