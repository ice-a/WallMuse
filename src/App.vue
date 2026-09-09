<script setup>
import { ref, onMounted, provide } from 'vue';
import GalleryView from './components/GalleryView.vue';
import DiscoverView from './components/DiscoverView.vue';
import CreateView from './components/CreateView.vue';
import SettingsView from './components/SettingsView.vue';
import ChatView from './components/ChatView.vue';
import CmsView from './components/CmsView.vue';
import MusicView from './components/MusicView.vue';
import NovelView from './components/NovelView.vue';

const view = ref('gallery');
const items = ref([]);
const settings = ref({});
const platform = ref({ platform: '', backend: '' });
const toast = ref('');
const toastType = ref('ok');
let toastTimer = null;

function showToast(msg, type = 'ok') {
  toast.value = msg;
  toastType.value = type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 3000);
}

async function refresh() { items.value = await window.wallmuse.list(); }
async function loadSettings() { settings.value = await window.wallmuse.getSettings(); }

provide('appCtx', {
  items, settings, refresh, loadSettings, showToast, platform,
  // Web 模式下图库条目直接是 http/data 地址，原样透传；桌面版走 media:// 自定义协议
  mediaUrl: (item) => (/^(https?:|data:)/.test(item.path) ? item.path : 'media://img/' + encodeURIComponent(item.path)),
});

// ---------- 首次启动：数据存储位置向导 ----------
const setup = ref(null); // { defaultDir } | null = 不显示

onMounted(async () => {
  await Promise.all([refresh(), loadSettings()]);
  platform.value = await window.wallmuse.platform();
  window.wallmuse.onRotated(() => showToast('已自动轮换壁纸'));
  // 首启向导：数据目录尚未配置时弹出（用户可以一直跳过，不强制）
  const st = await window.wallmuse.storageStatus();
  if (!st.configured) setup.value = { defaultDir: st.defaultDir };
});

async function useDefault() {
  const r = await window.wallmuse.storageUse(setup.value.defaultDir);
  if (r.ok) setup.value = null;
  else showToast(r.error || '设置失败', 'err');
}

async function pickDir() {
  const r = await window.wallmuse.storagePick();
  if (r.canceled) return;
  const u = await window.wallmuse.storageUse(r.dir);
  if (u.ok) setup.value = null;
  else showToast(u.error || '设置失败', 'err');
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">Wall<span>Flow</span></div>
      <div class="nav-item" :class="{ active: view === 'gallery' }" @click="view = 'gallery'">
        🖼 图库 <span class="cnt">{{ items.length }}</span>
      </div>
      <div class="nav-item" :class="{ active: view === 'discover' }" @click="view = 'discover'">
        🔍 发现
      </div>
      <div class="nav-item" :class="{ active: view === 'cms' }" @click="view = 'cms'">
        🎬 影视
      </div>
      <div class="nav-item" :class="{ active: view === 'music' }" @click="view = 'music'">
        🎵 音乐
      </div>
      <div class="nav-item" :class="{ active: view === 'novel' }" @click="view = 'novel'">
        📖 小说
      </div>
      <div class="nav-item" :class="{ active: view === 'chat' }" @click="view = 'chat'">
        💬 AI 对话
      </div>
      <div class="nav-item" :class="{ active: view === 'create' }" @click="view = 'create'">
        ✨ AI 创作
      </div>
      <div class="nav-item" :class="{ active: view === 'settings' }" @click="view = 'settings'">
        ⚙ 设置
      </div>
      <div class="sidebar-footer">
        {{ platform.platform }} · {{ platform.backend }}
      </div>
    </aside>

    <main class="main">
      <GalleryView v-show="view === 'gallery'" />
      <DiscoverView v-if="view === 'discover'" />
      <CmsView v-if="view === 'cms'" />
      <MusicView v-if="view === 'music'" />
      <NovelView v-if="view === 'novel'" />
      <ChatView v-if="view === 'chat'" />
      <CreateView v-if="view === 'create'" />
      <SettingsView v-if="view === 'settings'" />
    </main>

    <!-- 首启：数据存储位置 -->
    <div v-if="setup" class="modal-mask">
      <div class="setup-panel">
        <h3 style="margin: 0 0 8px">欢迎使用 WallMuse</h3>
        <p style="color: var(--text-dim); font-size: 13px; line-height: 1.7; margin: 0 0 16px">
          请选择数据存储位置（图库、下载、AI 记录将保存在这里），之后可在设置页随时迁移。
        </p>
        <div class="preset-card" style="cursor: pointer" @click="useDefault">
          <b>使用默认位置</b>
          <div class="kv" style="margin-top: 4px">{{ setup.defaultDir }}</div>
        </div>
        <div class="preset-card" style="cursor: pointer" @click="pickDir">
          <b>选择其他目录…</b>
          <div class="kv" style="margin-top: 4px">自定义存放位置，支持后续整体迁移</div>
        </div>
        <button class="ghost" style="margin-top: 4px" @click="setup = null">暂不设置，稍后在「设置」里配置</button>
      </div>
    </div>

    <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
  </div>
</template>
