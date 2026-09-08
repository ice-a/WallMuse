// Bing 每日壁纸 API — 域名列表由设置提供（wallmuse-config 导入），逐个降级尝试
// 官方归档仅保留最近约 15 天，因此实际可用分页为 MAX_PAGE 页
const fs = require('fs');
const path = require('path');
const https = require('https');

const PAGE_SIZE = 8;
const MAX_PAGE = 2; // idx=0 (最近8天) / idx=8 (再往前8天)，超出会返回重复数据

function getJson(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WallMuse/1.0' }, timeout }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('解析响应失败: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('请求超时')); });
  });
}

function search({ page = 1 } = {}, hosts = []) {
  hosts = (Array.isArray(hosts) ? hosts : []).filter((h) => /^https?:\/\//.test(h));
  if (!hosts.length) {
    return Promise.resolve({ ok: false, error: '未配置 Bing 壁纸接口地址，请先在设置中导入源配置' });
  }
  const p = Math.max(1, Math.min(Number(page) || 1, MAX_PAGE));
  const idx = (p - 1) * PAGE_SIZE;
  const paths = hosts.map((h) => `${h.replace(/\/+$/, '')}/HPImageArchive.aspx?format=js&idx=${idx}&n=${PAGE_SIZE}`);
  let attempt = 0;
  const tryNext = () => {
    if (attempt >= paths.length) {
      return Promise.resolve({ ok: false, error: 'Bing 壁纸服务不可达（已尝试全部配置的域名）' });
    }
    return getJson(paths[attempt++]).then((j) => {
      const list = j.images || [];
      return {
        ok: true,
        page: p,
        totalPages: MAX_PAGE,
        items: list.map((w) => {
          const full = hosts[0] + w.url; // 统一走第一个域名的 CDN 下载
          const thumb = full.replace(/_1920x1080\.jpg/, '_640x360.jpg') || full;
          const largeThumb = full.replace(/_1920x1080\.jpg/, '_1280x720.jpg') || full;
          return {
            id: 'bing_' + w.startdate,
            url: hosts[0] + w.urlbase,
            path: full,
            name: w.copyright || ('Bing ' + w.startdate),
            width: 1920, height: 1080,
            thumb, largeThumb,
            colors: [], purity: 100,
          };
        }),
      };
    }).catch(tryNext);
  };
  return tryNext();
}

function download(wall, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(new URL(wall.path).pathname) || '.jpg';
    const dest = path.join(destDir, `${wall.id}${ext}`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return resolve({ ok: true, path: dest });
    const req = https.get(wall.path, { headers: { 'User-Agent': 'WallMuse/1.0' }, timeout: 60000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error('下载失败 HTTP ' + res.statusCode));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve({ ok: true, path: dest })));
      file.on('error', reject);
    });
    req.on('error', (e) => { try { fs.unlinkSync(dest); } catch {} reject(e); });
    req.on('timeout', function () { this.destroy(new Error('下载超时')); });
  });
}

module.exports = { search, download, MAX_PAGE };
