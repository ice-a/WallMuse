<script setup>
import { ref, inject, onMounted, onBeforeUnmount, nextTick, watch, computed } from 'vue';

const ctx = inject('appCtx');

// ---------- 音乐源（内置网易云开放接口 + Meting 自定义实例，同 CMS 的管理方式） ----------
const apis = ref([]);
const apiIdx = ref(0);
const newApi = ref('');
const testMsg = ref(null);
const SERVERS = [
  { key: 'netease', name: '网易云' },
  { key: 'tencent', name: 'QQ音乐' },
  { key: 'kugou', name: '酷狗' },
  { key: 'baidu', name: '百度' },
];
const server = ref('netease');
const isMeting = computed(() => apis.value[apiIdx.value] && apis.value[apiIdx.value].url !== 'builtin:netease');

onMounted(async () => {
  // 预设即设置里的 musicApis（wallmuse-config 导入 + 手动添加），去重合并
  const mine = (ctx.settings.value.musicApis || []).map((a) => ({ ...a, custom: true, kind: 'meting' }));
  const presets = (await window.wallmuse.musicPresets()).filter((p) => !mine.some((a) => a.url === p.url));
  apis.value = [...mine, ...presets];
  const saved = ctx.settings.value.musicActive;
  if (saved) {
    const i = apis.value.findIndex((a) => a.url === saved);
    if (i >= 0) apiIdx.value = i;
  }
  server.value = ctx.settings.value.musicServer || 'netease';
});

function persistApis() {
  window.wallmuse.setSettings({
    musicApis: apis.value.filter((a) => a.custom).map(({ name, url }) => ({ name, url })),
    musicActive: apis.value[apiIdx.value]?.url || '',
    musicServer: server.value,
  });
}

async function addApi() {
  const url = newApi.value.trim();
  if (!/^https?:\/\//.test(url)) { testMsg.value = { ok: false, hint: '请输入 http(s) 开头的接口地址' }; return; }
  testMsg.value = { ok: null, hint: '测试中…' };
  const r = await window.wallmuse.musicTest(url);
  testMsg.value = r;
  if (r.ok) {
    if (apis.value.some((a) => a.url === url)) { testMsg.value = { ok: false, hint: '该接口已存在' }; return; }
    apis.value.unshift({ name: `自定义源 ${apis.value.filter((a) => a.custom).length + 1}`, url, custom: true });
    apiIdx.value = 0;
    newApi.value = '';
    persistApis();
  }
}

function removeApi() {
  const a = apis.value[apiIdx.value];
  if (!a?.custom) { ctx.showToast('内置接口不能删除', 'err'); return; }
  apis.value.splice(apiIdx.value, 1);
  apiIdx.value = 0;
  persistApis();
}

// ---------- 搜索 ----------
const wd = ref('');
const list = ref([]); // 搜索结果即播放列表
const loading = ref(false);
const error = ref('');
const searched = ref(false);

async function doSearch() {
  if (!wd.value.trim()) return;
  loading.value = true;
  error.value = '';
  try {
    const r = await window.wallmuse.musicSearch({ api: apis.value[apiIdx.value].url, server: server.value, wd: wd.value.trim() });
    if (r.ok) {
      list.value = r.items;
      persistApis();
    } else {
      error.value = r.error || '搜索失败';
      list.value = [];
    }
  } catch (e) {
    error.value = String(e.message || e);
  } finally {
    loading.value = false;
    searched.value = true;
  }
}

// ---------- 播放器 ----------
const audioEl = ref(null);
const cur = ref(null);
const idx = ref(-1);
const isPlaying = ref(false);
const tCur = ref(0);
const tDur = ref(0);
const volume = ref(90);

function playAt(i) {
  const t = list.value[i];
  if (!t?.url) return;
  idx.value = i;
  cur.value = t;
  nextTick(() => {
    const el = audioEl.value;
    if (!el) return;
    el.volume = volume.value / 100;
    el.src = t.url;
    el.play().catch(() => { /* 自动播放被拦截时用户手动点播放 */ });
  });
  loadLrc();
}

function togglePlay() {
  const el = audioEl.value;
  if (!el || !cur.value) return;
  el.paused ? el.play().catch(() => {}) : el.pause();
}
function next() { if (idx.value < list.value.length - 1) playAt(idx.value + 1); }
function prev() { if (idx.value > 0) playAt(idx.value - 1); }

function onSeek(e) {
  const el = audioEl.value;
  if (el && tDur.value) el.currentTime = (Number(e.target.value) / 100) * tDur.value;
}
function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

watch(volume, (v) => { if (audioEl.value) audioEl.value.volume = v / 100; });

function onAudioErr() {
  if (cur.value) ctx.showToast(`「${cur.value.name}」播放失败，可能是该源链接失效，试试下一首`, 'err');
  isPlaying.value = false;
}

// ---------- 歌词 ----------
const lrcLines = ref([]);   // [{ t, text }]
const lrcIdx = ref(-1);
const showLrc = ref(false);
const lrcBox = ref(null);

function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const txt = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!txt) continue;
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + parseFloat(m[2]), text: txt });
  }
  return out.sort((a, b) => a.t - b.t);
}

function loadLrc() {
  lrcLines.value = [];
  lrcIdx.value = -1;
  const u = cur.value?.lrc;
  if (!/^https?:\/\//.test(u || '')) return;
  window.wallmuse.musicLyrics(u).then((r) => { if (r.ok) lrcLines.value = parseLrc(r.text); });
}

function onTimeUpdate() {
  const el = audioEl.value;
  if (!el) return;
  tCur.value = el.currentTime;
  tDur.value = el.duration || 0;
  if (lrcLines.value.length) {
    let li = -1;
    for (let i = 0; i < lrcLines.value.length; i++) {
      if (lrcLines.value[i].t <= el.currentTime) li = i; else break;
    }
    if (li !== lrcIdx.value) {
      lrcIdx.value = li;
      nextTick(() => {
        const box = lrcBox.value;
        if (box && li >= 0) {
          const el2 = box.children[li];
          if (el2) box.scrollTop = el2.offsetTop - box.clientHeight / 2;
        }
      });
    }
  }
}

onBeforeUnmount(() => {
  const el = audioEl.value;
  if (el) { el.pause(); el.removeAttribute('src'); }
});
</script>

<template>
  <div class="music-layout">
    <div class="page-head" style="margin-bottom: 0">
      <h2>音乐</h2>
      <select v-if="isMeting" v-model="server" style="width: 110px" @change="persistApis" title="Meting 接口的音乐平台">
        <option v-for="sv in SERVERS" :key="sv.key" :value="sv.key">{{ sv.name }}</option>
      </select>
      <input v-model="wd" placeholder="搜索歌曲 / 歌手，如 海阔天空" style="width: 260px" @keyup.enter="doSearch" />
      <button class="primary" :disabled="loading || !apis.length" @click="doSearch">搜索</button>
      <button class="ghost" @click="persistApis">保存当前源</button>
    </div>

    <div class="tabs-note" style="color: var(--text-dim); font-size: 12px; margin: 8px 0 0 2px">
      网易云开放接口（免登录外链，VIP / 无版权曲目自动过滤）· 也支持添加 Meting 聚合接口部署实例（★ 为自定义源）
      <div class="row" style="margin-top: 8px; flex-wrap: wrap">
        <select v-model="apiIdx" style="width: 170px" @change="persistApis">
          <option v-for="(a, i) in apis" :key="a.url" :value="i">{{ (a.custom ? '★ ' : '') + a.name }}</option>
        </select>
        <input v-model="newApi" placeholder="添加 Meting 接口，如 https://your.host/api/meting" style="flex: 1; min-width: 240px" @keyup.enter="addApi" />
        <button :disabled="!newApi.trim()" @click="addApi">＋ 添加并测试</button>
        <button class="ghost" v-if="apis[apiIdx]?.custom" @click="removeApi">🗑 删除当前源</button>
      </div>
      <div v-if="testMsg" :style="{ fontSize: '12px', marginTop: '4px', color: testMsg.ok == null ? 'var(--text-dim)' : testMsg.ok ? 'var(--ok)' : 'var(--danger)' }">
        {{ testMsg.ok == null ? '⏳' : testMsg.ok ? '✓' : '✗' }} {{ testMsg.hint }}
      </div>
    </div>

    <!-- 结果列表 -->
    <div class="music-list">
      <div v-if="error" class="empty">⚠ {{ error }}</div>
      <div v-else-if="loading" class="empty"><span class="spinner"></span> 搜索中…</div>
      <div v-else-if="!list.length" class="empty">
        <div class="big">🎵</div>
        {{ searched ? '没有找到相关歌曲，换个关键词试试。' : '搜索歌曲，点击即可播放。' }}
      </div>
      <template v-else>
        <div v-for="(t, i) in list" :key="t.id + i" class="track-row" :class="{ on: idx === i }" @click="playAt(i)">
          <span class="track-idx">{{ i + 1 }}</span>
          <img v-if="t.pic" :src="t.pic" class="track-pic" loading="lazy" referrerpolicy="no-referrer" />
          <div v-else class="track-pic" style="display:flex; align-items:center; justify-content:center">♪</div>
          <div class="track-main">
            <div class="name">{{ t.name }}</div>
            <div class="sub">{{ t.artist }}{{ t.album ? ' · ' + t.album : '' }}</div>
          </div>
          <span v-if="idx === i" class="track-badge">{{ isPlaying ? '♪ 正在播放' : '已暂停' }}</span>
        </div>
      </template>
    </div>

    <!-- 播放条 -->
    <div class="player-bar">
      <img v-if="cur?.pic" :src="cur.pic" class="player-pic" referrerpolicy="no-referrer" />
      <div v-else class="player-pic" style="display:flex; align-items:center; justify-content:center; font-size:18px">♪</div>
      <div class="player-info">
        <div class="name" :title="cur?.name">{{ cur?.name || '未播放' }}</div>
        <div class="sub">{{ cur?.artist || '搜索并点击歌曲开始播放' }}</div>
      </div>
      <div class="player-ctrl">
        <button class="ghost" :disabled="idx <= 0" @click="prev">⏮</button>
        <button class="primary round" :disabled="!cur" @click="togglePlay">{{ isPlaying ? '⏸' : '▶' }}</button>
        <button class="ghost" :disabled="idx >= list.length - 1 || idx < 0" @click="next">⏭</button>
      </div>
      <div class="player-progress">
        <span class="kv">{{ fmt(tCur) }}</span>
        <input type="range" min="0" max="100" step="0.1" :value="tDur ? (tCur / tDur) * 100 : 0" :disabled="!tDur" @input="onSeek" />
        <span class="kv">{{ fmt(tDur) }}</span>
      </div>
      <button class="ghost" :class="{ on: showLrc }" :disabled="!cur" @click="showLrc = !showLrc">词</button>
      <input v-model.number="volume" type="range" min="0" max="100" class="vol" title="音量" />
      <audio ref="audioEl" @timeupdate="onTimeUpdate" @play="isPlaying = true" @pause="isPlaying = false"
             @ended="next" @error="onAudioErr"></audio>

      <!-- 歌词面板 -->
      <div v-if="showLrc && cur" class="lyrics-panel">
        <div ref="lrcBox" class="lyrics-scroll">
          <div v-if="!lrcLines.length" class="kv" style="text-align:center; padding: 20px 0">暂无歌词</div>
          <div v-for="(l, i) in lrcLines" :key="i" class="lrc-line" :class="{ on: i === lrcIdx }">{{ l.text }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
