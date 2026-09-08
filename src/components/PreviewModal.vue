<script setup>
import { ref, inject, computed } from 'vue';

const props = defineProps({ item: { type: Object, required: true } });
const emit = defineEmits(['close']);
const ctx = inject('appCtx');

const newTag = ref('');
const collName = ref('');
const collections = computed(() => {
  const set = new Set(['壁纸精选', '工作']);
  ctx.items.value.forEach((i) => i.collections.forEach((c) => set.add(c)));
  return [...set];
});
const busy = ref(false);

async function setWp() {
  busy.value = true;
  try {
    const r = await window.wallmuse.setWallpaper(props.item.id);
    r.ok ? ctx.showToast('壁纸已应用 ✓') : ctx.showToast('设置失败: ' + r.error, 'err');
  } finally { busy.value = false; }
}
async function toggleFav() {
  await window.wallmuse.toggleFav(props.item.id);
  await ctx.refresh();
  ctx.showToast(props.item.favorite ? '已取消收藏' : '已收藏 ★');
}
async function addTag() {
  if (!newTag.value.trim()) return;
  await window.wallmuse.addTag(props.item.id, newTag.value.trim());
  newTag.value = '';
  await ctx.refresh();
}
async function removeTag(t) {
  await window.wallmuse.removeTag(props.item.id, t);
  await ctx.refresh();
}
async function addToColl() {
  if (!collName.value) return;
  await window.wallmuse.addToCollection(props.item.id, collName.value);
  await ctx.refresh();
  ctx.showToast(`已加入「${collName.value}」`);
}
async function removeItem() {
  if (!confirm('删除该壁纸？（移入系统回收站，可找回）')) return;
  await window.wallmuse.remove(props.item.id);
  await ctx.refresh();
  ctx.showToast('已删除');
  emit('close');
}
function reveal() {
  window.wallmuse.reveal(props.item.id);
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="preview-panel">
      <div class="preview-img-side">
        <img :src="ctx.mediaUrl(item)" />
      </div>
      <div class="preview-info">
        <h3>{{ item.name }}</h3>
        <div class="kv" v-if="item.prompt">Prompt: <b>{{ item.prompt }}</b></div>
        <div class="kv">来源: <b>{{ { ai: 'AI 生成', download: 'Wallhaven', import: '本地导入' }[item.source] }}</b></div>
        <div class="kv">大小: <b>{{ (item.size / 1024 / 1024).toFixed(2) }} MB</b></div>
        <div class="kv" v-if="item.appliedAt">上次应用: <b>{{ new Date(item.appliedAt).toLocaleString() }}</b></div>

        <div class="tag-row">
          <span v-if="item.favorite" class="tag">⭐ 收藏</span>
          <span v-for="t in item.tags" :key="t" class="tag">{{ t }} <span class="x" @click="removeTag(t)">✕</span></span>
        </div>

        <div class="row">
          <input v-model="newTag" placeholder="添加标签" @keyup.enter="addTag" style="flex: 1" />
          <button @click="addTag">添加</button>
        </div>

        <div class="row">
          <select v-model="collName" style="flex: 1">
            <option value="" disabled>加入集合…</option>
            <option v-for="c in collections" :key="c" :value="c">{{ c }}</option>
          </select>
          <button @click="addToColl">加入</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: auto">
          <button class="primary" :disabled="busy" @click="setWp">设为壁纸</button>
          <div class="row">
            <button style="flex: 1" @click="toggleFav">{{ item.favorite ? '取消收藏' : '收藏 ★' }}</button>
            <button style="flex: 1" @click="reveal()">打开位置</button>
          </div>
          <button style="color: var(--danger)" @click="removeItem">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>
