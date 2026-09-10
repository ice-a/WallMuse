import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// 本地 dev 时把 /api/rpc 桥接到 api/rpc.js，避免 Web 模式出现 HTTP 404。
// 生产环境由 Vercel 自动挂载该 Serverless Function，不需要这个插件。
function apiRpcDevPlugin() {
  return {
    name: 'wallmuse-api-rpc-dev',
    configureServer(server) {
      server.middlewares.use('/api/rpc', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: '仅支持 POST' }));
          return;
        }
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const text = Buffer.concat(chunks).toString('utf8');
          req.body = text ? JSON.parse(text) : {};

          // api/rpc.js 用 Vercel 风格的 res.status().json()，给原生 Node res 补上这两个方法
          if (!res.status) {
            res.status = (code) => { res.statusCode = code; return res; };
          }
          if (!res.json) {
            res.json = (data) => {
              if (!res.getHeader('Content-Type')) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
              }
              res.end(JSON.stringify(data));
            };
          }

          const handlerPath = require.resolve('./api/rpc.js');
          delete require.cache[handlerPath]; // 允许热重载
          const handler = require(handlerPath);
          await handler(req, res);
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), apiRpcDevPlugin()],
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets' },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
});
