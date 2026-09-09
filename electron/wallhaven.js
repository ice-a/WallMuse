// Wallhaven 公开 API（SFW）搜索与下载 — API 基址由设置提供（wallmuse-config 导入）
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function search({ q = '', sorting = 'relevancy', page = 1, atleast = '', colors = '', categories = '100', purity = '100' } = {}, apiBase = '', apiKey = '') {
  if (!/^https?:\/\//.test(String(apiBase))) {
    return Promise.resolve({ ok: false, error: '未配置 Wallhaven 接口地址，请先在设置中导入源配置' });
  }
  const url = new URL(apiBase.replace(/\/+$/, '') + '/search');
  if (apiKey) url.searchParams.set('apikey', String(apiKey));
  if (q) url.searchParams.set('q', q);
  url.searchParams.set('sorting', sorting);
  url.searchParams.set('page', String(page));
  url.searchParams.set('categories', categories);
  url.searchParams.set('purity', purity);
  if (atleast) url.searchParams.set('atleast', atleast);
  if (colors) url.searchParams.set('colors', colors);
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WallMuse/1.0' }, timeout: 15000 }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          resolve({
            ok: true,
            page: j.meta?.current_page || page,
            totalPages: j.meta?.last_page || 1,
            items: (j.data || []).map((w) => ({
              id: w.id, url: w.url, path: w.path,
              width: w.dimension_x, height: w.dimension_y,
              colors: w.colors || [], purity: w.purity,
              thumb: w.thumbs?.small || '', largeThumb: w.thumbs?.large || '',
            })),
          });
        } catch (e) { reject(new Error('解析响应失败: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('请求超时')); });
  });
}

function download(wall, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(new URL(wall.path).pathname) || '.jpg';
    const dest = path.join(destDir, `wallhaven_${wall.id}${ext}`);
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

module.exports = { search, download };
