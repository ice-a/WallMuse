<script setup>
import { ref, inject } from 'vue';

const ctx = inject('appCtx');
const s = ref(JSON.parse(JSON.stringify(ctx.settings.value)));
if (!Array.isArray(s.value.aiPresets)) s.value.aiPresets = [];
if (!Array.isArray(s.value.customSources)) s.value.customSources = { image: [], text: [], video: [] };
const saving = ref(false);
const testing = ref(null); // 正在测试的预设下标
const testResult = ref({}); // { [index]: {ok, error} }

async function save() {
  saving.value = true;
  try {
    s.value = await window.wallmuse.setSettings(s.value);
    ctx.settings.value = { ...s.value };
    ctx.showToast('设置已保存 ✓');
  } finally { saving.value = false; }
}

function addPreset() {
  s.value.aiPresets.push({ name: '', baseUrl: '', apiKey: '', model: '' });
}

function removePreset(i) {
  s.value.aiPresets.splice(i, 1);
  if ((s.value.aiActive || 0) >= s.value.aiPresets.length) s.value.aiActive = 0;
}

async function testPreset(i) {
  const p = s.value.aiPresets[i];
  if (!p.baseUrl || !p.model) {
    testResult.value = { ...testResult.value, [i]: { ok: false, error: '请先填写 Base URL 和模型' } };
    return;
  }
  testing.value = i;
  try {
    const r = await window.wallmuse.aiTest({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model });
    testResult.value = { ...testResult.value, [i]: r };
  } catch (e) {
    testResult.value = { ...testResult.value, [i]: { ok: false, error: String(e.message || e) } };
  } finally { testing.value = null; }
}

// ---------- 数据存储位置 ----------
const st = ref(null);        // storage status
const stBusy = ref(false);
const stMsg = ref(null);     // { ok, text }

async function loadStorage() {
  st.value = await window.wallmuse.storageStatus();
}
loadStorage();

async function pickAndUse() {
  const r = await window.wallmuse.storagePick();
  if (r.canceled) return;
  stBusy.value = true;
  try {
    const u = await window.wallmuse.storageUse(r.dir);
    stMsg.value = u.ok ? { ok: true, text: `已切换数据目录：${r.dir}` } : { ok: false, text: u.error };
    if (u.ok) { st.value = u.status; await ctx.refresh(); }
  } finally { stBusy.value = false; }
}

async function migrateTo() {
  const r = await window.wallmuse.storagePick();
  if (r.canceled) return;
  stBusy.value = true;
  try {
    const m = await window.wallmuse.storageMigrate(r.dir);
    if (m.ok) {
      st.value = m.status;
      stMsg.value = { ok: true, text: `迁移完成（${m.moved} 项数据），新位置：${r.dir}` };
      await ctx.refresh();
    } else {
      stMsg.value = { ok: false, text: m.error };
    }
  } finally { stBusy.value = false; }
}

// ---------- 自定义内容源 ----------
const KIND_LABEL = { image: '图片源', text: '文字源', video: '视频源' };
const KIND_KINDS = {
  image: [['direct', '直跳图片 (302直出)'], ['texturl', '返回直链文本'], ['json', 'JSON（取字段）']],
  text: [['plain', '纯文本'], ['json', 'JSON（取字段）']],
  video: [['direct', '直跳视频 (302直出)'], ['texturl', '返回直链文本'], ['json', 'JSON（取字段）']],
};
const newSrc = ref({ group: 'image', name: '', url: '', kind: 'direct', target: '' });
const srcTesting = ref(false);
const srcTestMsg = ref(null);

function onGroupChange() { newSrc.value.kind = newSrc.value.group === 'text' ? 'plain' : 'direct'; }

async function testCustomSrc() {
  const n = newSrc.value;
  if (!n.url) { srcTestMsg.value = { ok: false, hint: '请填写接口地址' }; return; }
  srcTesting.value = true;
  srcTestMsg.value = null;
  try {
    srcTestMsg.value = await window.wallmuse.apiTest({ ...n, group: n.group });
  } catch (e) {
    srcTestMsg.value = { ok: false, hint: String(e.message || e) };
  } finally { srcTesting.value = false; }
}

async function addCustomSrc() {
  const n = newSrc.value;
  if (!n.name.trim() || !n.url.trim()) { srcTestMsg.value = { ok: false, hint: '请填写名称和接口地址' }; return; }
  if (n.group !== 'text' && n.kind === 'json' && !n.target.trim()) {
    srcTestMsg.value = { ok: false, hint: 'JSON 模式需要填写字段路径，如 data.url' };
    return;
  }
  // 先测试再保存
  await testCustomSrc();
  if (!srcTestMsg.value?.ok) return;
  const list = s.value.customSources[n.group] || [];
  list.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: n.name.trim(), url: n.url.trim(), kind: n.kind, target: n.target.trim(),
  });
  s.value.customSources = { ...s.value.customSources, [n.group]: list };
  await save();
  newSrc.value = { group: n.group, name: '', url: '', kind: n.kind, target: '' };
  srcTestMsg.value = { ok: true, hint: '已添加，发现页可选用（★ 标记）' };
}

async function removeCustomSrc(group, id) {
  s.value.customSources = {
    ...s.value.customSources,
    [group]: (s.value.customSources[group] || []).filter((x) => x.id !== id),
  };
  await save();
}

// ---------- 配置备份（导出 / 导入 JSON，防泄露脱敏） ----------
const expKeys = ref(false);     // 是否包含 API Key（默认不含，防泄露）
const expSources = ref(true);   // 是否包含自定义源 / 接口地址
const cfgBusy = ref(false);
const cfgMsg = ref(null);       // { ok, text }

async function exportConfig() {
  if (expKeys.value && !confirm('导出文件将包含明文 API Key，只建议个人备份，切勿分享给他人。\n继续导出？')) return;
  cfgBusy.value = true;
  try {
    const r = await window.wallmuse.configExport({ includeKeys: expKeys.value, includeSources: expSources.value });
    if (r.canceled) return;
    cfgMsg.value = r.ok
      ? { ok: true, text: `已导出（${r.summary}）：${r.path}` }
      : { ok: false, text: r.error || '导出失败' };
  } catch (e) {
    cfgMsg.value = { ok: false, text: String(e.message || e) };
  } finally { cfgBusy.value = false; }
}

async function importConfig() {
  if (!confirm('导入会覆盖同名的配置项（模型预设 / 自定义源 / 轮换设置等），继续？')) return;
  cfgBusy.value = true;
  try {
    const r = await window.wallmuse.configImport();
    if (r.canceled) return;
    handleImportResult(r);
  } catch (e) {
    cfgMsg.value = { ok: false, text: String(e.message || e) };
  } finally { cfgBusy.value = false; }
}

// ---------- 从 URL 导入配置 ----------
const importUrl = ref('');

async function importConfigFromUrl() {
  const url = importUrl.value.trim();
  if (!/^https?:\/\//i.test(url)) {
    cfgMsg.value = { ok: false, text: '请填写 http(s) 开头的配置文件地址' };
    return;
  }
  if (!confirm('从该 URL 拉取配置并导入？导入会覆盖同名的配置项，继续？')) return;
  cfgBusy.value = true;
  cfgMsg.value = { ok: null, text: '正在拉取并校验配置…' };
  try {
    const r = await window.wallmuse.configImportUrl(url);
    handleImportResult(r, 'URL');
  } catch (e) {
    cfgMsg.value = { ok: false, text: String(e.message || e) };
  } finally { cfgBusy.value = false; }
}

async function handleImportResult(r, via = '文件') {
  if (r.ok) {
    await ctx.loadSettings();
    s.value = JSON.parse(JSON.stringify(ctx.settings.value));
    cfgMsg.value = {
      ok: true,
      text: `已从${via}导入（${r.summary}）` + (r.hasKeys ? ' ✓' : ' ✓ 配置不含 API Key，相关预设请重新填写密钥'),
    };
  } else {
    cfgMsg.value = { ok: false, text: r.error || '导入失败' };
  }
}
</script>

<template>
  <div>
    <div class="page-head"><h2>设置</h2></div>

    <div class="ai-panel">
      <!-- 数据存储 -->
      <h3 style="font-size: 15px">数据存储位置</h3>
      <p style="color: var(--text-dim); font-size: 12px; margin-top: -6px">
        图库、下载、AI 生图与对话记录都保存在该目录；迁移会完整复制数据到新位置后切换。
      </p>
      <div v-if="st" class="preset-card">
        <div class="kv" style="margin-bottom: 8px">
          当前：<b style="word-break: break-all">{{ st.dataDir }}</b>
          <span v-if="st.dataDir === st.defaultDir" style="color: var(--text-dim)">（默认位置）</span>
        </div>
        <div class="kv" style="margin-bottom: 12px">
          已存 {{ st.itemCount }} 张图片 · 约 {{ (st.sizeBytes / 1024 / 1024).toFixed(1) }} MB
        </div>
        <div class="row">
          <button :disabled="stBusy" @click="pickAndUse">📂 直接切换目录（不搬数据）</button>
          <button class="primary" :disabled="stBusy" @click="migrateTo">
            <span v-if="stBusy"><span class="spinner"></span> 处理中…</span>
            <span v-else>🚚 迁移数据到新位置</span>
          </button>
        </div>
        <div v-if="stMsg" :style="{ fontSize: '12px', marginTop: '8px', color: stMsg.ok ? 'var(--ok)' : 'var(--danger)', wordBreak: 'break-all' }">
          {{ stMsg.ok ? '✓ ' : '✗ ' }}{{ stMsg.text }}
        </div>
      </div>

      <!-- AI 生图预设 -->
      <h3 style="font-size: 15px; margin-top: 26px">AI 生图 · 模型预设（OpenAI 兼容接口）</h3>
      <p style="color: var(--text-dim); font-size: 12px; margin-top: -6px">
        可添加多个预设（如 OpenAI / 自建中转 / 其他兼容服务），生图页可随时切换；★ 为默认预设。
      </p>

      <div v-for="(p, i) in s.aiPresets" :key="i" class="preset-card" :class="{ active: s.aiActive === i }">
        <div class="preset-head">
          <span style="cursor: pointer" :title="s.aiActive === i ? '默认预设' : '设为默认'"
                @click="s.aiActive = i">{{ s.aiActive === i ? '★' : '☆' }}</span>
          <input v-model="p.name" placeholder="预设名称（如 OpenAI / 中转站）" />
          <button class="ghost" style="color: var(--danger)" @click="removePreset(i)">删除</button>
        </div>
        <div class="field row">
          <div style="flex: 1">
            <label>Base URL（无需以 /v1 结尾）</label>
            <input v-model="p.baseUrl" placeholder="https://…（OpenAI 兼容服务地址）" />
          </div>
          <div style="flex: 1">
            <label>API Key</label>
            <input v-model="p.apiKey" type="password" placeholder="sk-…" />
          </div>
          <div style="flex: 1">
            <label>模型（如 dall-e-3、flux-dev）</label>
            <input v-model="p.model" placeholder="dall-e-3" />
          </div>
        </div>
        <div class="row">
          <button :disabled="testing === i" @click="testPreset(i)">
            <span v-if="testing === i"><span class="spinner"></span> 测试中…</span>
            <span v-else>测试连接</span>
          </button>
          <span v-if="testResult[i]" :style="{ color: testResult[i].ok ? 'var(--ok)' : 'var(--danger)', fontSize: '13px' }">
            {{ testResult[i].ok ? '✓ 连接成功，可以生图' : '✗ ' + testResult[i].error }}
          </span>
        </div>
      </div>

      <button @click="addPreset">＋ 添加预设</button>

      <!-- 自定义内容源 -->
      <h3 style="font-size: 15px; margin-top: 26px">自定义内容源（发现页使用）</h3>
      <p style="color: var(--text-dim); font-size: 12px; margin-top: -6px">
        添加任意图片 / 文字 / 视频接口；JSON 模式需填字段路径（如 data.url）。
      </p>

      <div class="preset-card">
        <div class="row" style="flex-wrap: wrap">
          <select v-model="newSrc.group" style="width: 100px" @change="onGroupChange">
            <option value="image">图片源</option>
            <option value="text">文字源</option>
            <option value="video">视频源</option>
          </select>
          <input v-model="newSrc.name" placeholder="名称" style="width: 130px" />
          <input v-model="newSrc.url" placeholder="接口地址 https://…" style="flex: 1; min-width: 240px" />
          <select v-model="newSrc.kind" style="width: 170px">
            <option v-for="[k, label] in KIND_KINDS[newSrc.group]" :key="k" :value="k">{{ label }}</option>
          </select>
          <input v-if="newSrc.kind === 'json'" v-model="newSrc.target" placeholder="字段路径如 data.url" style="width: 150px" />
        </div>
        <div class="row" style="margin-top: 10px">
          <button :disabled="srcTesting" @click="testCustomSrc">
            <span v-if="srcTesting"><span class="spinner"></span> 测试中…</span>
            <span v-else>🔌 测试</span>
          </button>
          <button class="primary" @click="addCustomSrc">＋ 添加</button>
          <span v-if="srcTestMsg" :style="{ fontSize: '12px', color: srcTestMsg.ok == null ? 'var(--text-dim)' : srcTestMsg.ok ? 'var(--ok)' : 'var(--danger)', wordBreak: 'break-all' }">
            {{ srcTestMsg.ok == null ? '⏳ ' : srcTestMsg.ok ? '✓ ' : '✗ ' }}{{ srcTestMsg.hint }}
          </span>
        </div>
      </div>

      <div v-for="g in ['image', 'text', 'video']" :key="g" v-show="(s.customSources[g] || []).length" style="margin-top: 10px">
        <div class="filter-label">{{ KIND_LABEL[g] }}</div>
        <div v-for="src in s.customSources[g]" :key="src.id" class="row" style="padding: 6px 0; border-bottom: 1px solid var(--border)">
          <span class="tag">★ {{ src.name }}</span>
          <span style="flex: 1; font-size: 12px; color: var(--text-dim); word-break: break-all">{{ src.url }}</span>
          <button class="ghost" style="color: var(--danger); font-size: 12px" @click="removeCustomSrc(g, src.id)">删除</button>
        </div>
      </div>

      <!-- 定时轮换 -->
      <h3 style="font-size: 15px; margin-top: 26px">定时轮换</h3>
      <div class="row" style="margin-bottom: 10px">
        <label style="font-size: 13px">
          <input type="checkbox" v-model="s.autoRotate" style="width: auto; margin-right: 6px" />
          启用自动轮换（从全部图库随机挑选）
        </label>
      </div>
      <div class="field" style="width: 200px">
        <label>轮换间隔（分钟）</label>
        <input type="number" v-model.number="s.rotateMinutes" min="1" max="1440" />
      </div>

      <!-- 配置备份 -->
      <h3 style="font-size: 15px; margin-top: 26px">配置备份（JSON 文件）</h3>
      <p style="color: var(--text-dim); font-size: 12px; margin-top: -6px">
        把模型预设、自定义内容源、轮换等配置提取成一个 JSON 文件；换电脑或重装后导入即可恢复。
        默认<b>不包含 API Key</b>，避免泄露。
      </p>
      <div class="preset-card">
        <label class="row" style="gap: 6px; font-size: 13px; cursor: pointer; margin-bottom: 8px">
          <input type="checkbox" v-model="expKeys" style="width: auto" />
          包含 API Key（明文，仅限个人备份，切勿分享）
        </label>
        <label class="row" style="gap: 6px; font-size: 13px; cursor: pointer; margin-bottom: 12px">
          <input type="checkbox" v-model="expSources" style="width: auto" />
          包含自定义内容源 / 接口地址（自定义源、影视源、音乐源）
        </label>
        <div class="row">
          <button :disabled="cfgBusy" @click="exportConfig">⬆ 导出配置…</button>
          <button :disabled="cfgBusy" @click="importConfig">⬇ 导入配置…</button>
        </div>
        <div class="row" style="margin-top: 10px">
          <input v-model="importUrl" placeholder="配置文件 URL（https://…/wallmuse-sources.json）"
                 style="flex: 1; min-width: 260px" @keyup.enter="importConfigFromUrl" />
          <button class="primary" :disabled="cfgBusy" @click="importConfigFromUrl">
            🌐 从 URL 导入
          </button>
        </div>
        <div class="kv" style="margin-top: 10px; line-height: 1.7">
          ⚠ 即使不含密钥，文件里也有你的接口地址与自定义源，属于隐私信息，请妥善保管、不要随意分享。
          从 URL 导入会先校验内容（合法 JSON、配置结构、地址格式），校验不通过不会写入。
        </div>
        <div v-if="cfgMsg" :style="{ fontSize: '12px', marginTop: '8px', color: cfgMsg.ok ? 'var(--ok)' : 'var(--danger)', wordBreak: 'break-all' }">
          {{ cfgMsg.ok ? '✓ ' : '✗ ' }}{{ cfgMsg.text }}
        </div>
      </div>

      <button class="primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存设置' }}
      </button>
    </div>
  </div>
</template>
