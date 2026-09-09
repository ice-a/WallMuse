import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { createWebAdapter } from './web-adapter';

// Web 部署（Vercel）：浏览器里没有 preload 提供的 window.wallmuse，挂载 Web 适配器接管
if (!window.wallmuse) window.wallmuse = createWebAdapter();

createApp(App).mount('#app');
