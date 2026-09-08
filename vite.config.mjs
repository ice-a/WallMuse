import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets' },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
});
