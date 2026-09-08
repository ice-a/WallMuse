// AI 生图 — OpenAI 兼容 /v1/images/generations（b64_json 优先，url 回退）
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function postJson(urlStr, body, apiKey, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const data = JSON.stringify(body);
    const req = mod.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (res.statusCode >= 400) {
            reject(new Error(j.error?.message || `HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
          } else resolve(j);
        } catch (e) { reject(new Error(`响应解析失败 (HTTP ${res.statusCode}): ${buf.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时（生图通常需要 10–60 秒，请耐心）')));
    req.write(data);
    req.end();
  });
}

function downloadUrl(urlStr, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(u, { timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadUrl(res.headers.location, timeout).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('图片下载超时')));
  });
}

/**
 * generate({baseUrl, apiKey, model, prompt, size})
 * 返回 { ok, b64?:Buffer, url?, error? }
 */
async function generate({ baseUrl, apiKey, model, prompt, size }) {
  const base = baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/v1') || /\/v\d+$/.test(base)
    ? base + '/images/generations'
    : base + '/v1/images/generations';
  try {
    const j = await postJson(url, { model, prompt, n: 1, size }, apiKey);
    const d = j.data && j.data[0];
    if (!d) return { ok: false, error: '接口未返回图片数据' };
    if (d.b64_json) {
      return { ok: true, b64: Buffer.from(d.b64_json, 'base64') };
    }
    if (d.url) {
      // url 回退：主动拉取，保证本地保存
      const buf = await downloadUrl(d.url);
      return { ok: true, b64: buf };
    }
    return { ok: false, error: '返回中既无 b64_json 也无 url' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** 把生成结果写入磁盘，返回保存路径 */
function saveImage(result, destDir, prompt) {
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = String(prompt || 'ai').trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30) || 'ai';
    const file = path.join(destDir, `${stamp}_${slug}.png`);
    fs.writeFileSync(file, result.b64);
    return file;
  } catch {
    return null;
  }
}

/** 连接测试：用一个 64x64 小图请求验证配置可用 */
async function test({ baseUrl, apiKey, model }) {
  const r = await generate({ baseUrl, apiKey, model, prompt: 'a tiny red dot', size: '256x256' });
  return { ok: r.ok, error: r.error || '' };
}

module.exports = { generate, saveImage, test };
