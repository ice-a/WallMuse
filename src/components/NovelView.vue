<script setup>
import { ref, inject, onMounted, computed, watch } from 'vue';

const ctx = inject('appCtx');

// ---------- 数据 ----------
// n: { id, title, outline, notes, topical, briefing, chapters: [{ id, title, content, summary }], updatedAt }
const novels = ref([]);
const curId = ref('');
const curChId = ref('');
const cur = computed(() => novels.value.find((n) => n.id === curId.value));
const curCh = computed(() => cur.value?.chapters.find((c) => c.id === curChId.value));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

onMounted(async () => {
  novels.value = (await window.wallmuse.getNovels()) || [];
  // 旧数据回填新字段
  for (const n of novels.value) {
    n.notes = n.notes || '';
    n.topical = !!n.topical;
    n.briefing = n.briefing || '';
    for (const c of n.chapters || []) c.summary = c.summary || '';
  }
  if (!curId.value && novels.value.length) select(novels.value[0].id);
});

// 编辑防抖自动保存（流式生成期间变动频繁，间隔自动放宽）
let saveTimer = null;
const saveDelay = () => (aiBusy.value ? 3000 : 500);
watch(novels, () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.wallmuse.setNovels(JSON.parse(JSON.stringify(novels.value)));
  }, saveDelay());
}, { deep: true });

function addNovel() {
  const n = { id: uid(), title: `新书 ${novels.value.length + 1}`, outline: '', notes: '', topical: false, briefing: '', chapters: [], updatedAt: Date.now() };
  novels.value.unshift(n);
  select(n.id);
}

function removeNovel() {
  const n = cur.value;
  if (!n) return;
  if (!confirm(`删除《${n.title}》及其全部 ${n.chapters.length} 个章节？此操作不可恢复。`)) return;
  novels.value = novels.value.filter((x) => x.id !== n.id);
  curId.value = novels.value[0]?.id || '';
  curChId.value = '';
}

function select(id) {
  curId.value = id;
  curChId.value = novels.value.find((n) => n.id === id)?.chapters[0]?.id || '';
}

// ---------- 章节 ----------
function addChapter() {
  const n = cur.value;
  if (!n) return;
  const c = { id: uid(), title: `第${n.chapters.length + 1}章`, content: '', summary: '' };
  n.chapters.push(c);
  curChId.value = c.id;
}

function removeChapter(c) {
  const n = cur.value;
  n.chapters = n.chapters.filter((x) => x.id !== c.id);
  if (curChId.value === c.id) curChId.value = n.chapters[0]?.id || '';
}

function moveChapter(c, d) {
  const arr = cur.value.chapters;
  const i = arr.indexOf(c);
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

// ---------- AI 辅助（复用「AI 对话」里配置的模型） ----------
const aiBusy = ref(false);

async function aiAsk(task, system) {
  const r = await window.wallmuse.chatSend({
    presetIndex: ctx.settings.value.chatActive || 0,
    messages: [{ role: 'user', content: task }],
    system: system || '',
  });
  if (!r.ok) throw new Error(r.error || '请求失败，请先在「AI 对话」页配置模型');
  return String(r.content || '');
}

// 流式输出：增量直接落到目标字段（正文/小结），生成过程实时可见
let streamOn = null; // { obj, field, base, acc }
window.wallmuse.onChatChunk(({ delta }) => {
  if (streamOn) {
    streamOn.acc += delta;
    streamOn.obj[streamOn.field] = streamOn.base + streamOn.acc;
  }
});

async function aiStreamInto(obj, field, task, system, { append = false } = {}) {
  const base = append ? String(obj[field] || '') : '';
  streamOn = { obj, field, base, acc: '' };
  aiBusy.value = true;
  try {
    if (!append) obj[field] = '';
    const text = await aiAsk(task, system);
    // 兜底：以接口返回的全文为准（增量可能因事件丢失而不完整）
    obj[field] = (base + text).trim();
  } finally {
    streamOn = null;
    aiBusy.value = false;
  }
}

const tail = (s, n) => {
  s = String(s || '').trim();
  return s.length > n ? '…' + s.slice(-n) : s;
};

const NOVELIST =
  '你是一位功底深厚的中文小说作家，文笔流畅、画面感强、擅长伏笔与节奏控制。' +
  '严格只输出正文本身，不要输出章节标题、解释或「好的，以下是」之类的开场白。';

/** 全书上下文：大纲 + 人物设定 + 前文各章小结（保证不偏题、不脱节） */
function bookContext(n, upTo = Infinity) {
  const prev = n.chapters
    .slice(0, upTo === Infinity ? n.chapters.length : upTo)
    .filter((c) => (c.content || '').trim())
    .slice(-40);
  const sums = prev
    .map((c, i) => {
      const s = (c.summary || '').trim();
      return `${i + 1}. ${c.title}：${s || '（未小结，正文开头：' + c.content.replace(/\s+/g, ' ').slice(0, 100) + '…）'}`;
    })
    .join('\n');
  return (
    `【全书大纲】\n${(n.outline || '').trim() || '（暂无）'}\n` +
    ((n.notes || '').trim() ? `\n【人物与设定】（必须严格遵守，不得崩人设）\n${n.notes.trim()}\n` : '') +
    (sums ? `\n【前文章节小结】（剧情必须与这些小结保持连贯，不得矛盾、不得重复）\n${sums}\n` : '')
  );
}

/** 紧跟时事：注入今天日期 + 用户素材，让故事有时代感 */
function topicalCtx(n) {
  if (!n.topical) return '';
  const today = new Date().toISOString().slice(0, 10);
  return (
    `\n【时事要求】今天是 ${today}。在不破坏故事逻辑的前提下，自然融入近期的现实热点、流行文化梗或社会话题（用你掌握的最新知识），让故事更有时代感，但不得喧宾夺主。\n` +
    ((n.briefing || '').trim() ? `用户提供的时事素材（优先融合这些）：\n${n.briefing.trim()}\n` : '')
  );
}

/** 根据大纲拆分章节目录 */
async function aiChapters() {
  const n = cur.value;
  if (!n) return;
  if (!n.outline.trim()) { ctx.showToast('请先在上方填写大纲，再让 AI 拆分章节', 'err'); return; }
  aiBusy.value = true;
  try {
    const text = await aiAsk(
      `请根据下面的大纲，为小说《${n.title}》规划章节目录。\n` +
      `大纲：\n${n.outline.trim()}\n\n` +
      `要求：只输出章节标题，每行一个，格式如「第1章 标题」，不要输出任何其他解释或序号以外的前后缀。`,
      '你是一位小说编辑。'
    );
    const titles = String(text).split(/\r?\n/)
      .map((l) => l.replace(/^[-*>#\d.、\s]+/, '').trim())
      .filter((l) => l && l.length <= 50)
      .slice(0, 80);
    if (!titles.length) { ctx.showToast('AI 没有返回可用的章节标题', 'err'); return; }
    for (const t of titles) n.chapters.push({ id: uid(), title: t, content: '', summary: '' });
    ctx.showToast(`已根据大纲生成 ${titles.length} 个章节 ✓`);
  } catch (e) {
    ctx.showToast(String(e.message || e), 'err');
  } finally { aiBusy.value = false; }
}

/** AI 撰写当前章节正文（全书上下文 + 伏笔要求） */
async function aiWrite() {
  const n = cur.value, c = curCh.value;
  if (!n || !c) return;
  if (c.content.trim() && !confirm(`「${c.title}」已有内容，重新生成将覆盖，确定？（想追加请用「AI 续写」）`)) return;
  const i = n.chapters.indexOf(c);
  const prev = n.chapters[i - 1];
  const system = NOVELIST + '\n' + bookContext(n, i) + topicalCtx(n) +
    (prev && prev.content.trim() ? `\n【上一章结尾】\n${tail(prev.content, 600)}\n` : '');
  const task =
    `请为《${n.title}》撰写「${c.title}」一章的完整正文，约 1400 字。\n\n` +
    `要求：\n` +
    `1. 紧扣全书大纲与前文小结推进剧情，自然衔接上一章结尾，不得与前文矛盾；\n` +
    `2. 至少埋一处伏笔或彩蛋（为后续章节或结局留钩子）；\n` +
    `3. 直接输出正文。`;
  await aiStreamInto(c, 'content', task, system);
  ctx.showToast('本章已生成 ✓ 记得点「本章小结」保持连贯');
}

/** AI 续写当前章节（追加，不覆盖） */
async function aiContinue() {
  const n = cur.value, c = curCh.value;
  if (!n || !c) return;
  if (!(c.content || '').trim()) {
    ctx.showToast('本章还没有内容，先用「AI 写本章」或手动输入，再续写', 'err');
    return;
  }
  const i = n.chapters.indexOf(c);
  const prev = n.chapters[i - 1];
  const system = NOVELIST + '\n' + bookContext(n, i) + topicalCtx(n) +
    (prev && prev.content.trim() ? `\n【上一章结尾】\n${tail(prev.content, 600)}\n` : '');
  const task =
    `请续写《${n.title}》「${c.title}」一章。本章已写的内容如下：\n\n` +
    `${tail(c.content, 3000)}\n\n` +
    `要求：\n` +
    `1. 从已写内容的最后一个情节无缝接着往下写，约 800-1200 字，不要重复已有内容，不要改写前文；\n` +
    `2. 情节推进必须服务全书大纲，与前文各章小结保持连贯；\n` +
    `3. 至少埋一处新伏笔或彩蛋；\n` +
    `4. 只输出续写部分的正文。`;
  await aiStreamInto(c, 'content', task, system, { append: true });
  ctx.showToast('已续写并接上 ✓');
}

/** 单章小结：情节梗概 + 伏笔记录，供后续章节保持连贯 */
async function aiSummarize(c) {
  const n = cur.value;
  if (!n || !c) return;
  if (!(c.content || '').trim()) { ctx.showToast('本章还没有正文，无法总结', 'err'); return; }
  const system = '你是一位小说编辑。只输出小结文本本身，不要标题、不要解释。';
  const task =
    `请为《${n.title}》的「${c.title}」写一份本章小结（150-250 字）：\n` +
    `1. 概括本章主要情节与人物状态变化；\n` +
    `2. 结尾单独一行，以「伏笔：」开头，列出本章埋下的伏笔/彩蛋（没有就写「伏笔：无」）。\n` +
    `这份小结将用于约束后续章节的连贯性，请精炼准确。\n\n本章正文：\n${c.content.trim()}`;
  await aiStreamInto(c, 'summary', task, system);
  ctx.showToast('小结已生成 ✓');
}

/** 批量补全：给所有已写但未小结的章节生成小结 */
async function aiSummarizeAll() {
  const n = cur.value;
  if (!n) return;
  const todo = n.chapters.filter((c) => (c.content || '').trim() && !(c.summary || '').trim());
  if (!todo.length) { ctx.showToast('已写的章节都有小结了 ✓'); return; }
  if (!confirm(`为 ${todo.length} 个未小结的章节逐一生成小结？（生成后写后续章节才能保持连贯）`)) return;
  aiBusy.value = true;
  try {
    for (let k = 0; k < todo.length; k++) {
      const c = todo[k];
      c.summary = (await aiAsk(
        `请为《${n.title}》的「${c.title}」写一份本章小结（150-250 字）：概括主要情节与人物变化，结尾单独一行以「伏笔：」列出本章伏笔/彩蛋（没有写「伏笔：无」）。只输出小结本身。\n\n本章正文：\n${c.content.trim()}`,
        '你是一位小说编辑。只输出小结文本本身。'
      )).trim();
    }
    ctx.showToast(`已补全 ${todo.length} 个章节小结 ✓`);
  } catch (e) {
    ctx.showToast(String(e.message || e), 'err');
  } finally { aiBusy.value = false; }
}

const exporting = computed(() => {
  const n = cur.value;
  if (!n) return '';
  const lines = [`《${n.title}》`, '', '【大纲】', n.outline || '（暂无）', ''];
  n.chapters.forEach((c) => {
    lines.push(c.title, c.content || '（未写）', '');
  });
  return lines.join('\n');
});

function exportTxt() {
  navigator.clipboard.writeText(exporting.value).then(() => ctx.showToast('全书已复制到剪贴板 ✓'));
}
</script>

<template>
  <div>
    <!-- 空状态 -->
    <div v-if="!novels.length" class="empty">
      <div class="big">📖</div>
      还没有作品，从一本书的大纲开始。<br /><br />
      <button class="primary" @click="addNovel">＋ 新建小说</button>
    </div>

    <div v-else class="novel-layout">
      <!-- 左：作品与章节列表 -->
      <aside class="novel-side">
        <div class="row" style="gap: 6px">
          <select v-model="curId" style="flex: 1; min-width: 0" @change="select(curId)">
            <option v-for="n in novels" :key="n.id" :value="n.id">{{ n.title || '未命名' }}</option>
          </select>
          <button title="新建小说" @click="addNovel">＋</button>
        </div>
        <div class="filter-label" style="margin-top: 10px">
          章节（{{ cur.chapters.length }}）
          <a href="javascript:;" style="color: var(--accent); margin-left: 6px" @click="addChapter">＋ 新增</a>
          <a href="javascript:;" style="color: var(--accent); margin-left: 6px" title="给所有已写但未小结的章节生成小结"
             @click="aiSummarizeAll">✦ 补全小结</a>
        </div>
        <div class="ch-list">
          <div v-if="!cur.chapters.length" class="kv" style="padding: 14px 4px; line-height: 1.8">
            暂无章节。填写右侧大纲后可让 AI 拆分章节，或直接手动新增。
          </div>
          <div v-for="(c, i) in cur.chapters" :key="c.id" class="ch-item" :class="{ on: c.id === curChId }" @click="curChId = c.id">
            <span class="ch-name">
              {{ i + 1 }}. {{ c.title || '未命名章节' }}
              <span v-if="(c.summary || '').trim()" title="已有小结（后续章节会参考它保持连贯）">✓</span>
            </span>
            <span class="ch-acts" @click.stop>
              <button title="上移" :disabled="i === 0" @click="moveChapter(c, -1)">↑</button>
              <button title="下移" :disabled="i === cur.chapters.length - 1" @click="moveChapter(c, 1)">↓</button>
              <button title="删除" @click="removeChapter(c)">✕</button>
            </span>
          </div>
        </div>
        <div class="row" style="gap: 6px; padding-top: 10px; border-top: 1px solid var(--border)">
          <button class="ghost" style="flex: 1" @click="exportTxt">复制全书</button>
          <button class="ghost" style="color: var(--danger)" @click="removeNovel">🗑 删除本书</button>
        </div>
      </aside>

      <!-- 右：大纲 + 章节编辑 -->
      <div class="novel-main" v-if="cur">
        <input class="novel-title" v-model="cur.title" placeholder="书名" />

        <div class="outline-card">
          <div class="row">
            <span class="filter-label">大纲（先描述故事的整体走向）</span>
            <span style="flex: 1"></span>
            <button :disabled="aiBusy" title="让 AI 根据大纲生成章节目录" @click="aiChapters">
              <span v-if="aiBusy"><span class="spinner"></span></span>
              <span v-else>✦ AI 拆分章节</span>
            </button>
          </div>
          <textarea v-model="cur.outline" placeholder="描述故事大纲：时代背景、主要人物、核心冲突、结局走向……&#10;写好后可点「AI 拆分章节」自动生成目录，也可以直接在左侧手动新增章节。"></textarea>
          <details style="margin-top: 8px">
            <summary class="filter-label" style="cursor: pointer; color: var(--text-dim)">人物设定 / 紧跟时事（可选，点击展开）</summary>
            <div style="margin-top: 8px">
              <div class="field" style="margin-bottom: 8px">
                <label>人物与设定（AI 写作时会严格遵守，保证不崩人设、不偏主题）</label>
                <textarea v-model="cur.notes" rows="3" style="line-height: 1.7"
                          placeholder="主角：姓名 / 性格 / 能力……&#10;重要配角与关系……&#10;世界观规则、力量体系……"></textarea>
              </div>
              <label class="row" style="gap: 6px; font-size: 12px; color: var(--text-dim); cursor: pointer">
                <input type="checkbox" v-model="cur.topical" style="width: auto" />
                紧跟时事（写作时融入近期热点事件 / 流行梗，让故事有时代感）
              </label>
              <textarea v-if="cur.topical" v-model="cur.briefing" rows="2" style="margin-top: 6px; line-height: 1.7"
                        placeholder="可选：粘贴近期的热点事件 / 素材，AI 优先融合这些；留空则由模型用自身最新知识发挥。"></textarea>
            </div>
          </details>
        </div>

        <div v-if="curCh" class="chapter-card">
          <div class="row" style="flex-wrap: wrap">
            <input v-model="curCh.title" placeholder="章节标题" style="flex: 1; min-width: 160px; font-weight: 600" />
            <button class="primary" :disabled="aiBusy" title="根据大纲、前文小结撰写本章正文（覆盖已有内容）" @click="aiWrite">
              <span v-if="aiBusy"><span class="spinner"></span> 生成中…</span>
              <span v-else>✦ AI 写本章</span>
            </button>
            <button :disabled="aiBusy" title="从已有内容末尾接着往下写（追加，不覆盖）" @click="aiContinue">
              <span v-if="aiBusy"><span class="spinner"></span></span>
              <span v-else>✦ AI 续写</span>
            </button>
            <button :disabled="aiBusy" title="生成本章小结与伏笔记录，后续章节会参考它保持连贯" @click="aiSummarize(curCh)">
              <span v-if="aiBusy"><span class="spinner"></span></span>
              <span v-else>✦ 本章小结</span>
            </button>
          </div>
          <textarea v-model="curCh.content" class="chapter-content" placeholder="章节正文……（可直接输入；「AI 写本章」从零生成，「AI 续写」从末尾接着写，生成过程实时显示）"></textarea>
          <details class="sum-box" :open="!(curCh.content || '').trim() && !(curCh.summary || '').trim()">
            <summary>
              本章小结{{ (curCh.summary || '').trim() ? `（${curCh.summary.trim().length} 字，后续章节写作时会自动参考）` : '（空——建议生成，保证后续章节不脱节）' }}
            </summary>
            <textarea v-model="curCh.summary" rows="3"
                      placeholder="本章小结：情节梗概 + 「伏笔：xxx」。可用「✦ 本章小结」生成，也可手写编辑。"></textarea>
          </details>
          <div class="kv">已保存 · {{ (curCh.content || '').length }} 字</div>
        </div>
        <div v-else class="empty" style="flex: 1; padding: 60px 0">
          从左侧选择一个章节开始创作，或「＋ 新增章节」。
        </div>
      </div>
    </div>
  </div>
</template>
