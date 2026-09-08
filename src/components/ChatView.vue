<script setup>
import { ref, computed, inject, onMounted, nextTick } from 'vue';

const ctx = inject('appCtx');
const s = ref({ baseUrl: '', apiKey: '', model: '', presets: [] });

// ---------- 配置（存 settings.chatPresets，第 0 个为当前） ----------
async function loadCfg() {
  await ctx.loadSettings();
  const st = ctx.settings.value;
  if (!Array.isArray(st.chatPresets)) st.chatPresets = [];
  if (!st.chatPresets.length) st.chatPresets = [{ name: '默认', baseUrl: '', apiKey: '', model: '' }];
  const p = st.chatPresets[st.chatActive || 0] || st.chatPresets[0];
  s.value = { baseUrl: p.baseUrl || '', apiKey: p.apiKey || '', model: p.model || '' };
  // 恢复上次选用的 Agent
  if (st.chatAgent && agents.value.some((a) => a.id === st.chatAgent)) agentId.value = st.chatAgent;
}

async function saveCfg() {
  const st = ctx.settings.value;
  const i = st.chatActive || 0;
  if (!st.chatPresets[i]) st.chatPresets[i] = { name: '默认' };
  st.chatPresets[i] = { ...st.chatPresets[i], ...s.value, name: st.chatPresets[i].name || '默认' };
  await window.wallmuse.setSettings({ chatPresets: st.chatPresets, chatActive: st.chatActive || 0 });
  await ctx.loadSettings();
}

// ---------- 模型列表 ----------
const models = ref([]);
const loadingModels = ref(false);
const modelErr = ref('');

async function fetchModels() {
  if (!s.value.baseUrl) { modelErr.value = '请先填写 Base URL'; return; }
  loadingModels.value = true;
  modelErr.value = '';
  try {
    const r = await window.wallmuse.chatModels({ baseUrl: s.value.baseUrl, apiKey: s.value.apiKey });
    if (r.ok) {
      models.value = r.models;
      if (!s.value.model || !r.models.includes(s.value.model)) {
        const pick = r.models.find((m) => /gpt-4o|gpt-4|claude|gemini|deepseek|qwen|glm/i.test(m)) || r.models[0];
        s.value.model = pick;
        await saveCfg();
      }
    } else {
      modelErr.value = r.error || '拉取失败';
    }
  } catch (e) {
    modelErr.value = String(e.message || e);
  } finally { loadingModels.value = false; }
}

// ---------- 连通测试 ----------
const testing = ref(false);
const testResult = ref(null); // { ok, hint?/error? }

async function testConn() {
  if (!s.value.baseUrl || !s.value.model) { testResult.value = { ok: false, error: '请先填写 Base URL 并选择模型' }; return; }
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await window.wallmuse.chatTest({ baseUrl: s.value.baseUrl, apiKey: s.value.apiKey, model: s.value.model });
  } catch (e) {
    testResult.value = { ok: false, error: String(e.message || e) };
  } finally { testing.value = false; }
}

// ---------- Agent（内置预设 + 自定义） ----------
const BUILTIN_AGENTS = [
  { id: 'general', emoji: '💬', name: '通用助手', prompt: '' },
  { id: 'translator', emoji: '🌐', name: '翻译官', prompt: '你是一位专业翻译。用户发来中文时翻译成地道的英文，发来其他语言时翻译成流畅的中文。只输出译文，不要解释；保留原文格式、代码与专有名词。' },
  { id: 'coder', emoji: '👨‍💻', name: '代码工程师', prompt: '你是一位资深软件工程师。回答先给结论再给代码，代码完整可运行并附简短说明；主动指出边界情况与常见坑；用中文解释。' },
  { id: 'writer', emoji: '✍️', name: '文案写手', prompt: '你是一位出色的中文文案创作者。文风自然、有画面感，避免套话和 AI 腔。根据用户给的场景直接产出文案，可给 2-3 个不同风格的版本供挑选。' },
  { id: 'brainstorm', emoji: '🧠', name: '头脑风暴', prompt: '你是创意顾问。针对用户的主题快速给出 10 个以上不重样的点子，按「常规 → 大胆 → 离谱」排列，每个点子一句话说明，最后邀请用户挑选一个继续深挖。' },
  { id: 'wallpaper', emoji: '🖼️', name: '壁纸顾问', prompt: '你是壁纸与视觉审美顾问。根据用户的心情、场景和设备，推荐壁纸风格、配色与构图建议，并给出适合在图库 / Wallhaven / Bing 搜索的中英文关键词。' },
];

const agents = computed(() => {
  const custom = Array.isArray(ctx.settings.value.chatAgents) ? ctx.settings.value.chatAgents : [];
  return [...BUILTIN_AGENTS, ...custom];
});
const agentId = ref('general');

function currentAgent() {
  return agents.value.find((a) => a.id === agentId.value) || BUILTIN_AGENTS[0];
}

async function selectAgent(id) {
  agentId.value = id;
  try { await window.wallmuse.setSettings({ chatAgent: id }); } catch {}
}

// Agent 编辑器（新增 / 编辑 / 删除自定义 Agent）
const editing = ref(null); // { id?, emoji, name, prompt }

function openEditor(a = null) {
  editing.value = a ? { ...a } : { id: null, emoji: '🤖', name: '', prompt: '' };
}

async function saveAgent() {
  const e = editing.value;
  if (!e.name.trim() || !e.prompt.trim()) { ctx.showToast('名称和人设提示词都要填写', 'err'); return; }
  const st = ctx.settings.value;
  const list = Array.isArray(st.chatAgents) ? JSON.parse(JSON.stringify(st.chatAgents)) : [];
  if (e.id) {
    const i = list.findIndex((x) => x.id === e.id);
    if (i >= 0) list[i] = { ...e };
  } else {
    e.id = 'c_' + Date.now().toString(36);
    list.push({ ...e });
  }
  st.chatAgents = list;
  try { await window.wallmuse.setSettings({ chatAgents: list }); } catch {}
  editing.value = null;
  agentId.value = e.id;
  ctx.showToast('Agent 已保存 ✓');
}

async function removeAgent() {
  const e = editing.value;
  if (!confirm(`删除 Agent「${e.name}」？`)) return;
  const st = ctx.settings.value;
  const list = (st.chatAgents || []).filter((x) => x.id !== e.id);
  st.chatAgents = list;
  try { await window.wallmuse.setSettings({ chatAgents: list }); } catch {}
  editing.value = null;
  if (agentId.value === e.id) selectAgent('general');
  ctx.showToast('已删除');
}

// ---------- 对话 ----------
const messages = ref([]); // { role, content, agent? }
const input = ref('');
const sending = ref(false);
const streaming = ref(''); // 流式中的增量文本
const listEl = ref(null);

// 恢复历史
onMounted(async () => {
  await loadCfg();
  messages.value = (await window.wallmuse.getChats()) || [];
  scrollBottom();
});

function scrollBottom() {
  nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight; });
}

async function send() {
  const text = input.value.trim();
  if (!text || sending.value) return;
  if (!s.value.baseUrl || !s.value.model) {
    ctx.showToast('请先在上方配置 Base URL 和模型', 'err');
    return;
  }
  await saveCfg();
  const agent = currentAgent();
  input.value = '';
  messages.value.push({ role: 'user', content: text, agent: agent.name });
  sending.value = true;
  streaming.value = '';
  scrollBottom();
  try {
    // 只传最近 20 条，避免超出上下文；Agent 人设由主进程以 system 消息前置
    const payload = messages.value.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    const r = await window.wallmuse.chatSend({
      presetIndex: ctx.settings.value.chatActive || 0,
      messages: payload,
      system: agent.prompt || '',
    });
    // 流式增量已通过 onChatChunk 更新 streaming；此处兜底最终内容
    if (r.ok) {
      messages.value.push({ role: 'assistant', content: r.content || streaming.value, agent: agent.name });
    } else {
      messages.value.push({ role: 'assistant', content: '⚠ ' + (r.error || '请求失败') });
    }
  } catch (e) {
    messages.value.push({ role: 'assistant', content: '⚠ ' + String(e.message || e) });
  } finally {
    sending.value = false;
    streaming.value = '';
    scrollBottom();
    // 持久化
    try { await window.wallmuse.setChats(JSON.parse(JSON.stringify(messages.value.slice(-200)))); } catch {}
  }
}

window.wallmuse.onChatChunk(({ delta }) => {
  if (!sending.value) return;
  streaming.value += delta;
  scrollBottom();
});

function clearChat() {
  messages.value = [];
  window.wallmuse.setChats([]);
}

function copyMsg(t) {
  navigator.clipboard.writeText(t).then(() => ctx.showToast('已复制 ✓'), () => ctx.showToast('复制失败', 'err'));
}
</script>

<template>
  <div class="chat-layout">
    <!-- 左：模型配置 -->
    <aside class="chat-side">
      <h3 style="margin: 0 0 12px; font-size: 15px">对话模型</h3>
      <div class="field">
        <label>Base URL（OpenAI 兼容）</label>
        <input v-model="s.baseUrl" placeholder="https://…（OpenAI 兼容服务地址）" @blur="saveCfg" />
      </div>
      <div class="field">
        <label>API Key</label>
        <input v-model="s.apiKey" type="password" placeholder="sk-…" @blur="saveCfg" />
      </div>
      <div class="field">
        <label>模型</label>
        <div class="row" style="gap: 6px">
          <input v-if="!models.length" v-model="s.model" placeholder="手填，或点右侧拉取列表" style="flex: 1" @blur="saveCfg" />
          <select v-else v-model="s.model" style="flex: 1" @change="saveCfg">
            <option v-if="s.model && !models.includes(s.model)" :value="s.model">{{ s.model }}（手填）</option>
            <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
          </select>
          <button :disabled="loadingModels" :title="models.length ? '重新拉取' : '拉取模型列表'" @click="fetchModels">
            <span v-if="loadingModels"><span class="spinner"></span></span>
            <span v-else>⟳</span>
          </button>
        </div>
        <div v-if="models.length" style="font-size: 11px; color: var(--text-dim); margin-top: 4px">
          已拉取 {{ models.length }} 个模型 · <a href="javascript:;" style="color: var(--accent)" @click="models = []">改为手填</a>
        </div>
        <div v-if="modelErr" style="font-size: 12px; color: var(--danger); margin-top: 4px">✗ {{ modelErr }}</div>
      </div>
      <div class="row">
        <button :disabled="testing" @click="testConn">
          <span v-if="testing"><span class="spinner"></span> 测试中…</span>
          <span v-else>🔌 测试连通</span>
        </button>
        <button class="ghost" @click="clearChat">🗑 清空对话</button>
      </div>
      <div v-if="testResult" :style="{ fontSize: '12px', marginTop: '8px', color: testResult.ok ? 'var(--ok)' : 'var(--danger)', wordBreak: 'break-all' }">
        {{ testResult.ok ? '✓ ' + testResult.hint : '✗ ' + testResult.error }}
      </div>
      <div style="margin-top: auto; padding-top: 14px; font-size: 11px; color: var(--text-dim); line-height: 1.6">
        配置保存在设置里，与生图模型相互独立。<br />支持所有 OpenAI 兼容接口（中转站、Ollama、vLLM 等）。
      </div>
    </aside>

    <!-- 右：对话区 -->
    <div class="chat-main">
      <!-- Agent 选择栏 -->
      <div class="agent-bar">
        <span class="agent-label">Agent</span>
        <div class="agent-chips">
          <button v-for="a in agents" :key="a.id"
                  class="agent-chip" :class="{ on: a.id === agentId }"
                  :title="a.prompt || '无人设，直接对话'" @click="selectAgent(a.id)">
            {{ a.emoji }} {{ a.name }}
          </button>
          <button class="agent-chip add" title="添加自定义 Agent" @click="openEditor()">＋</button>
        </div>
        <button v-if="currentAgent().id !== 'general'" class="ghost agent-edit"
                title="编辑当前 Agent 人设" @click="openEditor(currentAgent())">✎</button>
      </div>

      <div ref="listEl" class="chat-list">
        <div v-if="!messages.length && !streaming" class="empty">
          <div class="big">{{ currentAgent().emoji }}</div>
          <template v-if="currentAgent().id === 'general'">和 AI 聊点什么吧 —— 配置好模型后直接输入。</template>
          <template v-else>
            当前 Agent：<b>{{ currentAgent().name }}</b><br />
            <span style="font-size: 12px">{{ currentAgent().prompt }}</span>
          </template>
        </div>
        <template v-for="(m, i) in messages" :key="i">
          <div class="msg" :class="m.role">
            <div class="msg-bubble">
              <div v-if="m.agent && m.agent !== '通用助手'" class="msg-agent">{{ m.agent }}</div>
              <div class="msg-text">{{ m.content }}</div>
              <div class="msg-actions">
                <button class="ghost" style="font-size: 11px; padding: 2px 6px" @click="copyMsg(m.content)">复制</button>
              </div>
            </div>
          </div>
        </template>
        <div v-if="streaming" class="msg assistant">
          <div class="msg-bubble streaming">
            <div v-if="currentAgent().id !== 'general'" class="msg-agent">{{ currentAgent().name }}</div>
            <div class="msg-text">{{ streaming }}<span class="cursor">▍</span></div>
          </div>
        </div>
        <div v-else-if="sending" class="msg assistant"><div class="msg-bubble"><div class="msg-text">…</div></div></div>
      </div>

      <div class="chat-input-row">
        <textarea v-model="input" rows="2"
                  :placeholder="`以「${currentAgent().name}」身份对话 · Enter 发送 / Shift+Enter 换行`"
                  @keydown.enter.exact.prevent="send" @keydown.shift.enter.stop></textarea>
        <button class="primary send-btn" :disabled="sending || !input.trim()" @click="send">
          <span v-if="sending"><span class="spinner"></span></span>
          <span v-else>发送</span>
        </button>
      </div>
    </div>

    <!-- Agent 编辑器 -->
    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="agent-editor">
        <h3 style="margin: 0 0 14px; font-size: 15px">{{ editing.id ? '编辑 Agent' : '添加 Agent' }}</h3>
        <div class="row" style="gap: 10px; margin-bottom: 14px">
          <div style="width: 72px">
            <div class="field" style="margin-bottom: 0">
              <label>图标</label>
              <input v-model="editing.emoji" maxlength="4" style="text-align: center" />
            </div>
          </div>
          <div style="flex: 1">
            <div class="field" style="margin-bottom: 0">
              <label>名称</label>
              <input v-model="editing.name" placeholder="如：小红书标题助手" />
            </div>
          </div>
        </div>
        <div class="field">
          <label>人设 / System 提示词（决定这个 Agent 的行为）</label>
          <textarea v-model="editing.prompt" rows="7" resize="vertical"
                    placeholder="例：你是小红书爆款标题写手，根据用户给出的主题生成 5 个标题，要求带 emoji、有钩子、不超过 20 字。"></textarea>
        </div>
        <div class="row" style="justify-content: space-between">
          <button v-if="editing.id" class="ghost" style="color: var(--danger)" @click="removeAgent">🗑 删除</button>
          <span v-else></span>
          <div class="row">
            <button @click="editing = null">取消</button>
            <button class="primary" @click="saveAgent">保存</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
