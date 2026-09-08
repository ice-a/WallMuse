<script setup>
import { ref, inject, onMounted, onBeforeUnmount, nextTick, computed } from 'vue';
import Hls from 'hls.js';
import flvjs from 'flv.js';
import dashjs from 'dashjs';

const ctx = inject('appCtx');

// ---------- CMS 站点 ----------
const apis = ref([]);       // { name, url, custom? }
const apiIdx = ref(0);
const newApi = ref('');
const testMsg = ref(null);

onMounted(async () => {
  // 预设即设置里的 cmsApis（wallmuse-config 导入 + 手动添加），去重合并
  const mine = (ctx.settings.value.cmsApis || []).map((a) => ({ ...a, custom: true }));
  const presets = (await window.wallmuse.cmsPresets()).filter((p) => !mine.some((a) => a.url === p.url));
  apis.value = [...mine, ...presets];
  // 恢复上次使用的站
  const saved = ctx.settings.value.cmsActive;
  if (saved) {
    const i = apis.value.findIndex((a) => a.url === saved);
    if (i >= 0) apiIdx.value = i;
  }
});

function persistApis() {
  window.wallmuse.setSettings({
    cmsApis: apis.value.filter((a) => a.custom).map(({ name, url }) => ({ name, url })),
    cmsActive: apis.value[apiIdx.value]?.url || '',
  });
}

async function addApi() {
  const url = newApi.value.trim();
  if (!/^https?:\/\//.test(url)) { testMsg.value = { ok: false, hint: '请输入 http(s) 开头的接口地址' }; return; }
  testMsg.value = { ok: null, hint: '测试中…' };
  const r = await window.wallmuse.cmsTest(url);
  testMsg.value = r;
  if (r.ok) {
    if (apis.value.some((a) => a.url === url)) { testMsg.value = { ok: false, hint: '该接口已存在' }; return; }
    apis.value.unshift({ name: r.hint.includes('共') ? `自定义站 ${apis.value.filter((a) => a.custom).length + 1}` : '自定义站', url, custom: true });
    apiIdx.value = 0;
    newApi.value = '';
    persistApis();
  }
}

function removeApi() {
  const a = apis.value[apiIdx.value];
  if (!a?.custom) { ctx.showToast('内置站点不能删除', 'err'); return; }
  apis.value.splice(apiIdx.value, 1);
  apiIdx.value = 0;
  persistApis();
}

function switchApi() { persistApis(); doSearch(1); }

// ---------- 搜索 ----------
const wd = ref('');
const items = ref([]);
const page = ref(1);
const pageCount = ref(1);
const total = ref(0);
const loading = ref(false);
const error = ref('');

async function doSearch(p = 1) {
  loading.value = true;
  error.value = '';
  try {
    const r = await window.wallmuse.cmsSearch({ api: apis.value[apiIdx.value].url, wd: wd.value.trim(), pg: p });
    if (r.ok) {
      items.value = r.items;
      page.value = r.page;
      pageCount.value = r.pageCount;
      total.value = r.total;
      if (p === 1 && wd.value.trim()) persistApis();
    } else {
      error.value = r.error || '搜索失败';
      items.value = [];
    }
  } catch (e) {
    error.value = String(e.message || e);
  } finally { loading.value = false; }
}

// ---------- 详情 ----------
const detail = ref(null);   // 当前选中的 vod（含 plays）
const loadingDetail = ref(false);

async function openDetail(v) {
  loadingDetail.value = true;
  detail.value = v;
  try {
    // 搜索结果一般已带 plays；兜底拉一次详情
    if (!v.plays || !v.plays.length) {
      const r = await window.wallmuse.cmsDetail({ api: apis.value[apiIdx.value].url, id: v.id });
      if (r.ok) detail.value = { ...v, plays: r.vod.plays, content: r.vod.content || v.content };
      else ctx.showToast(r.error || '详情获取失败', 'err');
    }
    await nextTick();
  } finally { loadingDetail.value = false; }
}

// ---------- 播放器（hls.js） + 沉浸模式 ----------
const playerEl = ref(null);
let hls = null;
let flvPlayer = null;
let dashPlayer = null;
const playing = ref(null); // { name, url }
const playErr = ref('');
// 按扩展名判断流格式：hls / dash / flv / native(浏览器原生 mp4/webm/ogg/mov 等)
function mediaKind(u) {
  const m = String(u).split('?')[0].split('#')[0].match(/.([a-z0-9]+)$/i);
  const e = m ? m[1].toLowerCase() : '';
  if (e === 'm3u8') return 'hls';
  if (e === 'mpd') return 'dash';
  if (e === 'flv') return 'flv';
  return 'native';
}
// 沉浸模式：播放时隐藏搜索栏 / 详情 / 选集，只展示影片
const theater = ref(true);
const videoWrapEl = ref(null);
const curLine = ref('');   // 当前线路 from
const curEpIdx = ref(-1);  // 当前集在 episodes 中的下标
const curEps = computed(() => detail.value?.plays?.find((g) => g.from === curLine.value)?.episodes || []);
const hasPrev = computed(() => curEpIdx.value > 0);
const hasNext = computed(() => curEpIdx.value >= 0 && curEpIdx.value < curEps.value.length - 1);

function play(ep, from, ei = 0) {
  curLine.value = from;
  curEpIdx.value = ei;
  theater.value = true; // 点播即进入沉浸模式，可随时“显示详情 / 缩小”
  playing.value = { name: `${detail.value.name} · ${from} · ${ep.name}`, url: ep.url };
  playErr.value = '';
  nextTick(() => attachPlayer());
}

function stepEp(d) {
  const ni = curEpIdx.value + d;
  if (ni < 0 || ni >= curEps.value.length) return;
  play(curEps.value[ni], curLine.value, ni);
}

function closePlayer() {
  playing.value = null;
  destroyPlayer();
  const el = playerEl.value;
  if (el) { el.pause(); el.removeAttribute('src'); el.load?.(); }
}

function backToList() { closePlayer(); detail.value = null; }

function goFull() {
  const el = videoWrapEl.value;
  if (!el) return;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.();
}

function attachPlayer() {
  const el = playerEl.value;
  if (!el || !playing.value) return;
  destroyPlayer();
  const url = playing.value.url;
  const kind = mediaKind(url);
  if (kind === 'hls') {
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = url; // Safari 原生
    } else if (Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) playErr.value = `播放失败（${data.details}），可尝试换线路或浏览器打开`;
      });
      hls.loadSource(url);
      hls.attachMedia(el);
    } else {
      playErr.value = '当前环境不支持 HLS 播放';
    }
  } else if (kind === 'dash') {
    if (dashjs.supportsMediaSource()) {
      dashPlayer = dashjs.MediaPlayer().create();
      dashPlayer.initialize(el, url, true);
      dashPlayer.on('error', () => { playErr.value = 'DASH 播放失败，可尝试换线路或浏览器打开'; });
    } else {
      playErr.value = '当前环境不支持 DASH 播放';
    }
  } else if (kind === 'flv') {
    if (flvjs.isSupported()) {
      flvPlayer = flvjs.createPlayer({ type: 'flv', url, isLive: false });
      flvPlayer.attachMediaElement(el);
      flvPlayer.on(flvjs.Events.ERROR, () => { playErr.value = 'FLV 播放失败，可尝试换线路或浏览器打开'; });
      flvPlayer.load();
    } else {
      playErr.value = '当前环境不支持 FLV 播放（需 flv.js）';
    }
  } else {
    el.src = url; // mp4 / webm / ogg / mov 等浏览器原生格式
  }
  el.play().catch(() => { /* 需要用户手动点播放的情况 */ });
}

function destroyPlayer() {
  if (hls) { hls.destroy(); hls = null; }
  if (flvPlayer) { try { flvPlayer.destroy(); } catch (e) {} flvPlayer = null; }
  if (dashPlayer) { try { dashPlayer.reset(); } catch (e) {} dashPlayer = null; }
}

onBeforeUnmount(destroyPlayer);

function openExternal(url) { url && window.open(url, '_blank'); }
function copyUrl(u) { navigator.clipboard.writeText(u).then(() => ctx.showToast('已复制 ✓')); }
</script>

<template>
  <div>
    <div class="page-head" v-show="!(playing && theater)">
      <h2>影视</h2>
      <select v-model="apiIdx" style="width: 150px" @change="switchApi">
        <option v-for="(a, i) in apis" :key="a.url" :value="i">{{ (a.custom ? '★ ' : '') + a.name }}</option>
      </select>
      <input v-model="wd" placeholder="搜索片名，如 流浪地球" style="width: 240px" @keyup.enter="doSearch(1)" />
      <button class="primary" :disabled="loading || !apis.length" @click="doSearch(1)">搜索</button>
    </div>

    <div class="tabs-note" style="color: var(--text-dim); font-size: 12px; margin: 0 0 12px 2px" v-show="!(playing && theater)">
      苹果CMS V10 采集接口 · 在线播放 m3u8 / 直链视频（★ 为自定义站，可在下方添加采集接口）
      <div class="row" style="margin-top: 8px; flex-wrap: wrap">
        <input v-model="newApi" placeholder="添加采集接口，如 https://api.example.com/api.php/provide/vod" style="flex: 1; min-width: 260px" @keyup.enter="addApi" />
        <button :disabled="!newApi.trim()" @click="addApi">＋ 添加并测试</button>
        <button class="ghost" v-if="apis[apiIdx]?.custom" @click="removeApi">🗑 删除当前站</button>
      </div>
      <div v-if="testMsg" :style="{ fontSize: '12px', marginTop: '4px', color: testMsg.ok == null ? 'var(--text-dim)' : testMsg.ok ? 'var(--ok)' : 'var(--danger)' }">
        {{ testMsg.ok == null ? '⏳' : testMsg.ok ? '✓' : '✗' }} {{ testMsg.hint }}
      </div>
    </div>

    <!-- 详情 + 播放 -->
    <div v-if="detail" class="cms-detail">
      <!-- 播放条 + 播放器：播放时置顶，沉浸模式下独占页面 -->
      <template v-if="playing">
        <div class="theater-bar">
          <button class="ghost" @click="backToList">✕ 退出播放</button>
          <span class="theater-title" :title="playing.name">{{ playing.name }}</span>
          <button :disabled="!hasPrev" @click="stepEp(-1)">⏮ 上一集</button>
          <button :disabled="!hasNext" @click="stepEp(1)">下一集 ⏭</button>
          <button @click="theater = !theater">{{ theater ? '⧉ 显示详情' : '⤡ 缩小播放' }}</button>
          <button class="primary" @click="goFull">⛶ 全屏</button>
          <button class="ghost" @click="copyUrl(playing.url)">复制地址</button>
          <button class="ghost" @click="openExternal(playing.url)">浏览器打开</button>
        </div>
        <div ref="videoWrapEl" class="video-wrap" :class="{ theater }">
          <video ref="playerEl" class="video-player" controls autoplay preload="auto" @dblclick="goFull"></video>
          <div v-if="playErr" class="video-err">⚠ {{ playErr }}</div>
        </div>
      </template>

      <div class="cms-detail-info" v-show="!(playing && theater)">
        <img v-if="detail.pic" :src="detail.pic" class="cms-poster" referrerpolicy="no-referrer" />
        <div style="flex: 1; min-width: 0">
          <h3 style="margin: 0 0 6px">{{ detail.name }} <small style="color: var(--text-dim)">{{ detail.remarks }}</small></h3>
          <div class="kv" style="margin-bottom: 4px"><b>{{ detail.class }}</b> · {{ detail.year }} · {{ detail.area }}</div>
          <div v-if="detail.actor" class="kv">主演：{{ detail.actor }}</div>
          <div v-if="detail.director" class="kv">导演：{{ detail.director }}</div>
          <p v-if="detail.content" class="kv" style="margin: 8px 0 0; line-height: 1.7; max-height: 110px; overflow: auto">{{ detail.content }}</p>
          <div style="margin-top: 8px"><button class="ghost" @click="backToList">← 返回列表</button></div>
        </div>
      </div>
      <div v-if="detail.plays?.length" class="cms-eps" v-show="!(playing && theater)">
        <div v-for="g in detail.plays" :key="g.from" style="margin-bottom: 10px">
          <div class="filter-label" style="margin-bottom: 6px">线路：{{ g.from }}（{{ g.episodes.length }} 集）</div>
          <div class="ep-grid">
            <button v-for="(ep, ei) in g.episodes" :key="ep.url" class="ep-btn"
                    :class="{ on: playing?.url === ep.url }" @click="play(ep, g.from, ei)">
              {{ ep.name }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <template v-else>
      <div v-if="error" class="empty">⚠ {{ error }}<br /><br />可尝试切换站点，或添加其他采集接口。</div>
      <div v-else-if="loading" class="empty"><span class="spinner"></span> 搜索中…</div>
      <div v-else-if="!items.length" class="empty">
        <div class="big">🎬</div>
        输入片名搜索 CMS 资源站的影视剧集，点击卡片选集在线播放。
      </div>
      <div v-else class="grid">
        <div v-for="v in items" :key="v.id" class="card" @click="openDetail(v)">
          <img class="thumb" v-if="v.pic" :src="v.pic" loading="lazy" referrerpolicy="no-referrer" style="aspect-ratio: 3/4" />
          <div v-else class="thumb" style="display: flex; align-items: center; justify-content: center; font-size: 34px; aspect-ratio: 3/4">🎞</div>
          <div class="meta">
            <div class="name" :title="v.name">{{ v.name }}</div>
            <div class="sub">{{ v.remarks || v.class }} · {{ v.year }}</div>
          </div>
        </div>
      </div>
      <div v-if="items.length" class="row" style="justify-content: center; margin-top: 20px">
        <button :disabled="page <= 1 || loading" @click="doSearch(page - 1)">← 上一页</button>
        <span style="color: var(--text-dim)">第 {{ page }} / {{ pageCount }} 页 · 共 {{ total }} 部</span>
        <button :disabled="page >= pageCount || loading" @click="doSearch(page + 1)">下一页 →</button>
      </div>
    </template>
  </div>
</template>
