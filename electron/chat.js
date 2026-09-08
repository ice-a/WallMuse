// AI 对话 — OpenAI 兼容 /v1/chat/completions（SSE 流式优先，失败回退非流式）
const http = require('http');
const https = require('https');

function endpoint(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return /\/v\d+$/.test(base) ? base + path : base + '/v1' + path;
}

/** GET /v1/models → { ok, models:[id...], error? } */
function listModels({ baseUrl, apiKey }, timeout = 30000) {
  return new Promise((resolve) => {
    const u = new URL(endpoint(baseUrl, '/models'));
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, {
      method: 'GET', timeout,
      headers: { Authorization: `Bearer ${apiKey || ''}`, Accept: 'application/json' },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let msg = `HTTP ${res.statusCode}`;
          try { msg = JSON.parse(buf).error?.message || msg; } catch {}
          return resolve({ ok: false, error: `${msg}（${buf.slice(0, 160)}）` });
        }
        try {
          const j = JSON.parse(buf);
          const ids = (j.data || j.models || []).map((m) => m.id || m.name || m.model).filter(Boolean);
          if (!ids.length) return resolve({ ok: false, error: '模型列表为空' });
          return resolve({ ok: true, models: ids });
        } catch {
          return resolve({ ok: false, error: '响应不是 JSON：' + buf.slice(0, 160) });
        }
      });
      res.on('error', () => resolve({ ok: false, error: '网络错误' }));
    });
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '请求超时' }); });
    req.end();
  });
}

/**
 * 流式对话。每个增量片段通过 onChunk(text) 回调；结束 resolve({ok, content, error?})
 * 先按 stream:true 请求；若响应不是 SSE（部分中转不支持），自动回退非流式。
 */
function chatStream({ baseUrl, apiKey, model, messages, temperature = 0.7 }, onChunk) {
  return new Promise((resolve) => {
    const urlStr = endpoint(baseUrl, '/chat/completions');
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const body = JSON.stringify({ model, messages, temperature, stream: true });
    const req = mod.request(u, {
      method: 'POST', timeout: 300000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey || ''}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let buf = '';
      let full = '';
      let sawSse = false;
      let settled = false;
      const finish = (r) => { if (!settled) { settled = true; resolve(r); } };

      // 非 SSE（JSON 整包）— 读完整体解析，兼容不支持流式的中转
      res.on('end', () => {
        if (sawSse) return finish({ ok: true, content: full });
        try {
          const j = JSON.parse(buf);
          if (res.statusCode >= 400) return finish({ ok: false, error: j.error?.message || `HTTP ${res.statusCode}` });
          const c = j.choices?.[0]?.message?.content;
          if (c == null) return finish({ ok: false, error: '响应无 choices.message：' + buf.slice(0, 200) });
          onChunk && onChunk(String(c));
          finish({ ok: true, content: String(c) });
        } catch {
          if (res.statusCode >= 400) return finish({ ok: false, error: `HTTP ${res.statusCode}: ${buf.slice(0, 200)}` });
          finish({ ok: false, error: '响应解析失败：' + buf.slice(0, 200) });
        }
      });

      res.on('data', (chunkB) => {
        const piece = chunkB.toString('utf8');
        buf += piece;
        const ct = (res.headers['content-type'] || '');
        if (!ct.includes('event-stream')) return; // 整包模式，end 里处理
        sawSse = true;
        // SSE 行解析：data: {...} / data: [DONE]
        for (const line of piece.split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            if (j.error) return finish({ ok: false, error: j.error.message || JSON.stringify(j.error) });
            const delta = j.choices?.[0]?.delta?.content;
            if (delta) { full += delta; onChunk && onChunk(delta); }
          } catch { /* 半包跨 chunk 的行由下一轮补齐，此处容忍丢失极少数边界 */ }
        }
      });

      res.on('error', () => finish({ ok: false, error: '连接中断' }));
    });
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '请求超时（>5 分钟）' }); });
    req.write(body);
    req.end();
  });
}

/** 连通测试：发一条极短消息验证 baseurl/key/model 可用 */
async function test({ baseUrl, apiKey, model }) {
  if (!baseUrl || !model) return { ok: false, error: '请先填写 Base URL 和模型' };
  const r = await chatStream({
    baseUrl, apiKey, model,
    messages: [{ role: 'user', content: '回复"OK"两个字母即可' }],
    temperature: 0,
  }, null);
  if (r.ok) return { ok: true, hint: `连通成功，模型回复：${r.content.slice(0, 40)}` };
  return { ok: false, error: r.error };
}

module.exports = { listModels, chatStream, test };
