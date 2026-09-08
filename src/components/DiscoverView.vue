<script setup>
import { ref, inject, onMounted } from 'vue';

const ctx = inject('appCtx');
const source = ref('bing'); // bing | random | apiimg | apitext | apivideo | wallhaven
const SOURCES = [
  ['bing', 'Bing 每日'],
  ['random', '随机抓取'],
  ['apiimg', '接口图片'],
  ['apitext', '文字'],
  ['apivideo', '视频'],
  ['wallhaven', 'Wallhaven'],
];

// ---------- Bing 每日 ----------
const bingPage = ref(1);
const bingTotal = ref(2);
const bingResults = ref([]);
const bingLoading = ref(false);
const bingError = ref('');
const downloading = ref('');

async function loadBing(p = 1) {
  bingLoading.value = true;
  bingError.value = '';
  try {
    const r = await window.wallmuse.bingSearch({ page: p });
    if (r.ok) {
      bingResults.value = r.items;
      bingPage.value = r.page;
      bingTotal.value = r.totalPages;
    } else {
      bingError.value = r.error || 'Bing 搜索失败';
    }
  } catch (e) {
    bingError.value = String(e.message || e);
  } finally { bingLoading.value = false; }
}

async function downloadBing(wall) {
  downloading.value = wall.id;
  try {
    const r = await window.wallmuse.bingDownload(wall);
    if (r.ok) {
      await ctx.refresh();
      ctx.showToast('已下载入库 ✓');
    } else {
      ctx.showToast('下载失败: ' + (r.error || ''), 'err');
    }
  } catch (e) {
    ctx.showToast('下载失败: ' + (e.message || e), 'err');
  } finally { downloading.value = ''; }
}

// ---------- 随机抓取 ----------
const randKind = ref('desktop'); // desktop | mobile
const randCount = ref(12);
const randLoading = ref(false);
const randError = ref('');
const randResults = ref([]);

async function fetchRandom() {
  randLoading.value = true;
  randError.value = '';
  try {
    const r = await window.wallmuse.randFetch({ kind: randKind.value, count: randCount.value });
    if (r.ok) {
      randResults.value = r.items || [];
      await ctx.refresh();
      ctx.showToast(`已抓取 ${r.items.length} 张入库 ✓` + (r.failed ? `（${r.failed} 张失败）` : ''));
    } else {
      randError.value = r.error || '抓取失败';
    }
  } catch (e) {
    randError.value = String(e.message || e);
  } finally { randLoading.value = false; }
}

// ---------- 接口内容源（图片/文字/视频，含自定义源） ----------
const apiSrcMap = ref({ image: [], text: [], video: [] });
const imgSrcKey = ref('');
const imgCount = ref(6);
const imgLoading = ref(false);
const imgError = ref('');
const imgResults = ref([]);

const txtSrcKey = ref('');
const txtLoading = ref(false);
const txtError = ref('');
const txtCurrent = ref(null); // { text, source }
const txtHistory = ref([]);   // 最近几条

const vidSrcKey = ref('');
const vidLoading = ref(false);
const vidError = ref('');
const vidUrl = ref('');
const vidName = ref('');

async function loadApiSources() {
  try {
    apiSrcMap.value = await window.wallmuse.apiSources();
    if (!imgSrcKey.value && apiSrcMap.value.image.length) imgSrcKey.value = apiSrcMap.value.image[0].key;
    if (!txtSrcKey.value && apiSrcMap.value.text.length) txtSrcKey.value = apiSrcMap.value.text[0].key;
    if (!vidSrcKey.value && apiSrcMap.value.video.length) vidSrcKey.value = apiSrcMap.value.video[0].key;
  } catch (e) {
    imgError.value = txtError.value = vidError.value = String(e.message || e);
  }
}
function findSrc(group, key) { return apiSrcMap.value[group].find((s) => s.key === key); }

async function fetchApiImages() {
  // __mix__ = 全部源轮流混合抓取
  const src = imgSrcKey.value === '__mix__'
    ? { key: '__mix__', name: '混合抓取' }
    : findSrc('image', imgSrcKey.value);
  if (!src) return;
  imgLoading.value = true;
  imgError.value = '';
  try {
    const r = await window.wallmuse.apiImage({ source: src, count: imgCount.value });
    if (r.ok) {
      imgResults.value = r.items || [];
      await ctx.refresh();
      ctx.showToast(`「${src.name}」抓取 ${r.items.length} 张入库 ✓` + (r.failed ? `（${r.failed} 张失败）` : ''));
    } else {
      imgError.value = r.error || '抓取失败';
    }
  } catch (e) {
    imgError.value = String(e.message || e);
  } finally { imgLoading.value = false; }
}

async function fetchApiText() {
  const src = findSrc('text', txtSrcKey.value);
  if (!src) return;
  txtLoading.value = true;
  txtError.value = '';
  try {
    const r = await window.wallmuse.apiText({ source: src });
    if (r.ok) {
      txtCurrent.value = { text: r.text, source: r.source };
      txtHistory.value = [txtCurrent.value, ...txtHistory.value].slice(0, 8);
    } else {
      txtError.value = r.error || '获取失败';
    }
  } catch (e) {
    txtError.value = String(e.message || e);
  } finally { txtLoading.value = false; }
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); ctx.showToast('已复制 ✓'); }
  catch { ctx.showToast('复制失败', 'err'); }
}

async function fetchApiVideo() {
  const src = findSrc('video', vidSrcKey.value);
  if (!src) return;
  vidLoading.value = true;
  vidError.value = '';
  try {
    const r = await window.wallmuse.apiVideo({ source: src });
    if (r.ok) {
      vidUrl.value = r.url;
      vidName.value = src.name;
    } else {
      vidError.value = r.error || '解析失败';
    }
  } catch (e) {
    vidError.value = String(e.message || e);
  } finally { vidLoading.value = false; }
}

function openExternal(url) { url && window.open(url, '_blank'); }

// ---------- Wallhaven ----------
const q = ref('');
const sorting = ref('hot');
const atleast = ref('1920x1080');
const color = ref('');
const page = ref(1);
const totalPages = ref(1);
const results = ref([]);
const loading = ref(false);
const error = ref('');

// Wallhaven 官方支持的 colors 参数
const COLORS = [
  ['660000', '#660000'], ['9d2b2b', '#9d2b2b'], ['d63031', '#d63031'], ['e76e21', '#e76e21'],
  ['e6c229', '#e6c229'], ['9bbf65', '#9bbf65'], ['4ec163', '#4ec163'], ['2c7a44', '#2c7a44'],
  ['158462', '#158462'], ['0f766e', '#0f766e'], ['148d93', '#148d93'], ['1e6f9f', '#1e6f9f'],
  ['2c5faa', '#2c5faa'], ['3f4bd9', '#3f4bd9'], ['5443c9', '#5443c9'], ['6d3bd1', '#6d3bd1'],
  ['8f49b9', '#8f49b9'], ['b451ab', '#b451ab'], ['d15390', '#d15390'], ['dc5c85', '#dc5c85'],
  ['999999', '#999999'], ['808080', '#808080'], ['666666', '#666666'], ['4d4d4d', '#4d4d4d'],
  ['333333', '#333333'], ['1a1a1a', '#1a1a1a'], ['000000', '#000000'], ['ffffff', '#ffffff'],
];
const RESOLUTIONS = ['', '1920x1080', '2560x1440', '3440x1440', '3840x2160', '1280x800', '2560x1600'];

async function doSearch(p = 1) {
  loading.value = true;
  error.value = '';
  try {
    const r = await window.wallmuse.whSearch({
      q: q.value, sorting: sorting.value, page: p,
      atleast: atleast.value, colors: color.value,
    });
    if (r.ok) {
      results.value = r.items;
      page.value = r.page;
      totalPages.value = r.totalPages;
    } else {
      error.value = r.error || '搜索失败';
    }
  } catch (e) {
    error.value = String(e.message || e);
  } finally { loading.value = false; }
}

async function download(wall) {
  downloading.value = wall.id;
  try {
    const r = await window.wallmuse.whDownload(wall);
    if (r.ok) {
      await ctx.refresh();
      ctx.showToast('已下载入库 ✓');
    } else {
      ctx.showToast('下载失败: ' + (r.error || ''), 'err');
    }
  } catch (e) {
    ctx.showToast('下载失败: ' + (e.message || e), 'err');
  } finally { downloading.value = ''; }
}

function switchSource(s) {
  source.value = s;
  if (s === 'bing' && !bingResults.value.length && !bingError.value) loadBing(1);
  if ((s === 'apiimg' || s === 'apitext' || s === 'apivideo') && !apiSrcMap.value.image.length) loadApiSources();
}

onMounted(loadApiSources);
</script>

<template>
  <div>
    <div class="page-head">
      <h2>发现</h2>
      <div class="tabs">
        <button v-for="[key, label] in SOURCES" :key="key" :class="{ on: source === key }" @click="switchSource(key)">{{ label }}</button>
      </div>
      <template v-if="source === 'wallhaven'">
        <input v-model="q" placeholder="搜索关键词，如 landscape / city / anime" style="width: 240px"
               @keyup.enter="doSearch(1)" />
        <select v-model="sorting" style="width: 120px">
          <option value="hot">热门</option>
          <option value="toplist">最多收藏</option>
          <option value="relevancy">相关度</option>
          <option value="random">随机</option>
        </select>
        <select v-model="atleast" style="width: 130px" title="最低分辨率">
          <option v-for="r in RESOLUTIONS" :key="r" :value="r">{{ r || '分辨率不限' }}</option>
        </select>
        <button class="primary" :disabled="loading" @click="doSearch(1)">搜索</button>
      </template>
      <template v-else-if="source === 'random'">
        <select v-model="randKind" style="width: 130px" :disabled="randLoading">
          <option value="desktop">桌面横屏</option>
          <option value="mobile">手机竖屏</option>
        </select>
        <select v-model="randCount" style="width: 110px" :disabled="randLoading">
          <option :value="6">6 张</option>
          <option :value="12">12 张</option>
          <option :value="24">24 张</option>
        </select>
        <button class="primary" :disabled="randLoading" @click="fetchRandom">
          <span v-if="randLoading"><span class="spinner"></span> 抓取中…</span>
          <span v-else>🎲 开始抓取</span>
        </button>
      </template>
      <template v-else-if="source === 'apiimg'">
        <select v-model="imgSrcKey" style="width: 150px" :disabled="imgLoading">
          <option value="__mix__">🎲 混合（全部源）</option>
          <option v-for="s in apiSrcMap.image" :key="s.key" :value="s.key">{{ (s.custom ? '★ ' : '') + s.name }}</option>
        </select>
        <select v-model="imgCount" style="width: 100px" :disabled="imgLoading">
          <option :value="3">3 张</option>
          <option :value="6">6 张</option>
          <option :value="12">12 张</option>
        </select>
        <button class="primary" :disabled="imgLoading" @click="fetchApiImages">
          <span v-if="imgLoading"><span class="spinner"></span> 抓取中…</span>
          <span v-else>🖼 抓取入库</span>
        </button>
      </template>
      <template v-else-if="source === 'apitext'">
        <select v-model="txtSrcKey" style="width: 140px" :disabled="txtLoading">
          <option v-for="s in apiSrcMap.text" :key="s.key" :value="s.key">{{ (s.custom ? '★ ' : '') + s.name }}</option>
        </select>
        <button class="primary" :disabled="txtLoading" @click="fetchApiText">
          <span v-if="txtLoading"><span class="spinner"></span> 获取中…</span>
          <span v-else>✒ 来一条</span>
        </button>
      </template>
      <template v-else-if="source === 'apivideo'">
        <select v-model="vidSrcKey" style="width: 140px" :disabled="vidLoading">
          <option v-for="s in apiSrcMap.video" :key="s.key" :value="s.key">{{ (s.custom ? '★ ' : '') + s.name }}</option>
        </select>
        <button class="primary" :disabled="vidLoading" @click="fetchApiVideo">
          <span v-if="vidLoading"><span class="spinner"></span> 解析中…</span>
          <span v-else>🎬 换一个</span>
        </button>
      </template>
    </div>

    <div class="tabs-note" style="color: var(--text-dim); font-size: 12px; margin: 0 0 12px 2px">
      <template v-if="source === 'bing'">Bing 官方每日精选（国内直连），每页 8 张，归档共 {{ bingTotal }} 页 · 点击下载入库</template>
      <template v-else-if="source === 'random'">并发抓取随机壁纸（多个源自动降级），抓到即入库</template>
      <template v-else-if="source === 'apiimg'">选择图片接口抓取，或用「混合」让全部源轮流出图；★ 为自定义源，可在设置页添加</template>
      <template v-else-if="source === 'apitext'">一句话/语录接口，换一条、一键复制</template>
      <template v-else-if="source === 'apivideo'">随机短视频接口，解析后在线播放（★ 为自定义源）</template>
      <template v-else>Wallhaven 公开图库（SFW），需可访问其官方接口的网络环境</template>
    </div>

    <!-- Bing -->
    <template v-if="source === 'bing'">
      <div v-if="bingError" class="empty">⚠ {{ bingError }}</div>
      <div v-else-if="bingLoading" class="empty"><span class="spinner"></span> 加载中…</div>
      <div v-else-if="!bingResults.length" class="empty">
        <div class="big">🌅</div>
        Bing 每日精选壁纸，点击"加载"或切换页码。
        <div style="margin-top: 14px"><button class="primary" @click="loadBing(1)">加载最新 8 张</button></div>
      </div>
      <div class="grid">
        <div v-for="w in bingResults" :key="w.id" class="card">
          <img class="thumb" :src="w.largeThumb || w.thumb" loading="lazy" />
          <div class="meta">
            <div class="name" :title="w.name">{{ w.name }}</div>
          </div>
          <div style="padding: 0 10px 10px">
            <button style="width: 100%; font-size: 12px" :disabled="downloading === w.id" @click="downloadBing(w)">
              <span v-if="downloading === w.id"><span class="spinner"></span> 下载中…</span>
              <span v-else>⬇ 下载入库</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="bingResults.length" class="row" style="justify-content: center; margin-top: 20px">
        <button :disabled="bingPage <= 1 || bingLoading" @click="loadBing(bingPage - 1)">← 更新的</button>
        <span style="color: var(--text-dim)">第 {{ bingPage }} / {{ bingTotal }} 页（Bing 归档仅保留最近约 15 天）</span>
        <button :disabled="bingPage >= bingTotal || bingLoading" @click="loadBing(bingPage + 1)">更早的 →</button>
      </div>
    </template>

    <!-- 随机抓取 -->
    <template v-else-if="source === 'random'">
      <div v-if="randError" class="empty">⚠ {{ randError }}</div>
      <div v-else-if="!randResults.length" class="empty">
        <div class="big">🎲</div>
        选择方向和数量，一键并发抓取随机壁纸并自动入库。
      </div>
      <div class="grid">
        <div v-for="w in randResults" :key="w.id" class="card">
          <img class="thumb" :src="ctx.mediaUrl(w)" loading="lazy" />
          <div class="meta">
            <div class="name">✓ 已入库 · {{ Math.round(w.size / 1024) }} KB</div>
          </div>
        </div>
      </div>
    </template>

    <!-- 接口图片 -->
    <template v-else-if="source === 'apiimg'">
      <div v-if="imgError" class="empty">⚠ {{ imgError }}</div>
      <div v-else-if="!imgResults.length" class="empty">
        <div class="big">🖼</div>
        选择图片源和数量，抓取后自动入库图库（可设为壁纸）。
      </div>
      <div class="grid">
        <div v-for="w in imgResults" :key="w.id" class="card">
          <img class="thumb" :src="ctx.mediaUrl(w)" loading="lazy" />
          <div class="meta">
            <div class="name">✓ {{ w.name || '接口图片' }} · {{ Math.round(w.size / 1024) }} KB</div>
          </div>
        </div>
      </div>
    </template>

    <!-- 文字 -->
    <template v-else-if="source === 'apitext'">
      <div v-if="txtError" class="empty">⚠ {{ txtError }}</div>
      <div v-else-if="!txtCurrent" class="empty">
        <div class="big">✒</div>
        选择文字源，来一条语录 / 毒鸡汤 / 古诗 / 笑话。
      </div>
      <template v-else>
        <div class="quote-card">
          <div class="quote-text">{{ txtCurrent.text }}</div>
          <div class="row" style="justify-content: space-between; margin-top: 16px">
            <span style="color: var(--text-dim); font-size: 12px">—— {{ txtCurrent.source }}</span>
            <div class="row">
              <button @click="copyText(txtCurrent.text)">📋 复制</button>
              <button class="primary" :disabled="txtLoading" @click="fetchApiText">🔄 换一条</button>
            </div>
          </div>
        </div>
        <div v-if="txtHistory.length > 1" style="margin-top: 18px">
          <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 8px">历史记录</div>
          <div v-for="(h, i) in txtHistory.slice(1)" :key="i" class="quote-mini" @click="txtCurrent = h">
            <span class="quote-mini-text">{{ h.text }}</span>
            <span class="quote-mini-src">{{ h.source }}</span>
          </div>
        </div>
      </template>
    </template>

    <!-- 视频 -->
    <template v-else-if="source === 'apivideo'">
      <div v-if="vidError" class="empty">⚠ {{ vidError }}</div>
      <div v-else-if="!vidUrl" class="empty">
        <div class="big">🎬</div>
        选择视频源，点击"换一个"解析随机短视频并在线播放。
      </div>
      <div v-else class="video-wrap">
        <video :key="vidUrl" class="video-player" :src="vidUrl" controls autoplay loop preload="auto"></video>
        <div class="row" style="margin-top: 10px">
          <span style="color: var(--text-dim); font-size: 12px">来源：{{ vidName }} · 点击"换一个"刷新</span>
          <div class="row">
            <button @click="openExternal(vidUrl)">↗ 浏览器打开</button>
            <button class="primary" :disabled="vidLoading" @click="fetchApiVideo">🔄 换一个</button>
          </div>
        </div>
      </div>
    </template>

    <!-- Wallhaven -->
    <template v-else>
      <div class="filter-row">
        <span class="filter-label">颜色</span>
        <button class="swatch" :class="{ on: color === '' }" title="不限颜色"
                style="background: linear-gradient(135deg, #e05252, #4f8cff, #3fb96f)" @click="color = ''; doSearch(1)">✕</button>
        <button v-for="[name, hex] in COLORS" :key="name" class="swatch" :class="{ on: color === name }"
                :style="{ background: hex }" :title="'#' + name" @click="color = name; doSearch(1)"></button>
      </div>

      <div v-if="error" class="empty">⚠ {{ error }}<br /><br />Wallhaven 需要可访问其官方接口的网络环境（国内通常被墙，建议用 Bing 或随机源）。</div>
      <div v-else-if="loading" class="empty"><span class="spinner"></span> 搜索中…</div>
      <div v-else-if="!results.length" class="empty">
        <div class="big">🌐</div>
        搜索 Wallhaven 公开图库（SFW），点击卡片下方按钮即可下载入库。
      </div>

      <div class="grid">
        <div v-for="w in results" :key="w.id" class="card">
          <img class="thumb" :src="w.largeThumb || w.thumb" loading="lazy" />
          <div class="meta">
            <div class="name">#{{ w.id }} · {{ w.width }}×{{ w.height }}</div>
          </div>
          <div style="padding: 0 10px 10px">
            <button style="width: 100%; font-size: 12px" :disabled="downloading === w.id" @click="download(w)">
              <span v-if="downloading === w.id"><span class="spinner"></span> 下载中…</span>
              <span v-else>⬇ 下载入库</span>
            </button>
          </div>
        </div>
      </div>

      <div v-if="results.length" class="row" style="justify-content: center; margin-top: 20px">
        <button :disabled="page <= 1 || loading" @click="doSearch(page - 1)">← 上一页</button>
        <span style="color: var(--text-dim)">第 {{ page }} / {{ totalPages }} 页</span>
        <button :disabled="page >= totalPages || loading" @click="doSearch(page + 1)">下一页 →</button>
      </div>
    </template>
  </div>
</template>
