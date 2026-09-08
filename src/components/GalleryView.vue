<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import PreviewModal from './PreviewModal.vue';

const ctx = inject('appCtx');
const filter = ref('all'); // all | fav | collection:<name>
const search = ref('');
const collections = computed(() => {
  const set = new Set();
  ctx.items.value.forEach((i) => i.collections.forEach((c) => set.add(c)));
  return [...set];
});
const shown = computed(() => {
  let list = ctx.items.value;
  if (filter.value === 'fav') list = list.filter((i) => i.favorite);
  else if (filter.value.startsWith('collection:')) {
    const c = filter.value.slice(11);
    list = list.filter((i) => i.collections.includes(c));
  }
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((i) => (i.name + ' ' + (i.prompt || '') + ' ' + i.tags.join(' ')).toLowerCase().includes(q));
  return [...list].sort((a, b) => b.addedAt - a.addedAt);
});

const preview = ref(null);
const busy = ref(false);

async function importImages() {
  busy.value = true;
  try {
    const r = await window.wallmuse.import();
    if (r.added > 0) { await ctx.refresh(); ctx.showToast(`已导入 ${r.added} 张`); }
  } finally { busy.value = false; }
}
async function setWp(item) {
  busy.value = true;
  try {
    const r = await window.wallmuse.setWallpaper(item.id);
    r.ok ? ctx.showToast('壁纸已应用 ✓') : ctx.showToast('设置失败: ' + r.error, 'err');
  } finally { busy.value = false; }
}
async function randomWp() {
  const f = filter.value === 'fav' ? { favorite: true } : {};
  const r = await window.wallmuse.randomWallpaper(f);
  r.ok ? ctx.showToast('随机换了一张 ✓') : ctx.showToast('图库为空', 'err');
}
async function toggleFav(item) {
  await window.wallmuse.toggleFav(item.id);
  await ctx.refresh();
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2>图库</h2>
      <input v-model="search" placeholder="搜索名称 / 标签 / 提示词…" style="width: 220px" />
      <select v-model="filter" style="width: 150px">
        <option value="all">全部</option>
        <option value="fav">⭐ 收藏</option>
        <option v-for="c in collections" :key="c" :value="'collection:' + c">📁 {{ c }}</option>
      </select>
      <button class="primary" :disabled="busy" @click="importImages">导入图片</button>
      <button :disabled="busy" @click="randomWp">🎲 随机换一张</button>
    </div>

    <div v-if="!shown.length" class="empty">
      <div class="big">🌙</div>
      还没有壁纸。点击「导入图片」开始，或去「发现」页下载。
    </div>

    <div class="grid">
      <div v-for="item in shown" :key="item.id" class="card" @click="preview = item" @dblclick="setWp(item)">
        <img class="thumb" :src="ctx.mediaUrl(item)" loading="lazy" />
        <span v-if="item.source === 'ai'" class="badge">AI</span>
        <span v-else-if="item.source === 'download'" class="badge">下载</span>
        <button class="fav" @click.stop="toggleFav(item)">{{ item.favorite ? '★' : '☆' }}</button>
        <div class="meta">
          <div class="name">{{ item.name }}</div>
          <div class="sub">{{ new Date(item.addedAt).toLocaleDateString() }}</div>
        </div>
        <div style="padding: 0 10px 10px">
          <button style="width: 100%; font-size: 12px" :disabled="busy" @click.stop="setWp(item)">设为壁纸</button>
        </div>
      </div>
    </div>

    <PreviewModal v-if="preview" :item="preview" @close="preview = null" />
  </div>
</template>
