<script setup>
import { ref, inject } from 'vue';

const ctx = inject('appCtx');
const prompt = ref('');
const size = ref('1024x1024');
const presetIndex = ref(null); // null = 用设置页的默认预设
const generating = ref(false);
const lastImage = ref(''); // media url of generated image
const error = ref('');

const SIZES = ['1024x1024', '1024x1792', '1792x1024', '1440x900', '1920x1080'];
const presets = () => ctx.settings.value.aiPresets || [];

async function generate() {
  if (!prompt.value.trim() || generating.value) return;
  generating.value = true;
  error.value = '';
  lastImage.value = '';
  try {
    const r = await window.wallmuse.aiGenerate({
      prompt: prompt.value.trim(), size: size.value,
      presetIndex: presetIndex.value == null ? undefined : presetIndex.value,
    });
    if (r.ok) {
      lastImage.value = 'media://img/' + encodeURIComponent(r.path);
      await ctx.refresh();
      ctx.showToast('生成完成，已入库 ✓');
    } else {
      error.value = r.error || '生成失败';
    }
  } catch (e) {
    error.value = String(e.message || e);
  } finally { generating.value = false; }
}
</script>

<template>
  <div>
    <div class="page-head"><h2>AI 创作</h2></div>

    <div class="ai-panel">
      <div class="field">
        <label>提示词（Prompt）</label>
        <textarea v-model="prompt" rows="3" style="width: 100%"
                  placeholder="描述你想要的壁纸，例如：赛博朋克城市夜景，霓虹灯，雨天，电影感，超高清"></textarea>
      </div>
      <div class="field row">
        <div style="width: 240px">
          <label>模型预设</label>
          <select v-model="presetIndex">
            <option :value="null">默认{{ presets()[ctx.settings.value.aiActive]?.name ? '（' + presets()[ctx.settings.value.aiActive].name + '）' : '' }}</option>
            <option v-for="(p, i) in presets()" :key="i" :value="i">{{ p.name || p.model }}（{{ p.model }}）</option>
          </select>
          <div v-if="!presets().length" style="font-size: 12px; color: var(--text-dim); margin-top: 6px">
            尚未配置预设，将使用设置页的单一接口配置
          </div>
        </div>
        <div style="width: 200px">
          <label>尺寸</label>
          <select v-model="size">
            <option v-for="s in SIZES" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div style="margin-top: 20px">
          <button class="primary" :disabled="generating || !prompt.trim()" @click="generate">
            <span v-if="generating"><span class="spinner"></span> 生成中（10–60 秒）…</span>
            <span v-else>✨ 生成并入库</span>
          </button>
        </div>
      </div>

      <div v-if="error" class="empty" style="padding: 30px 0; color: var(--danger); text-align: left">
        ⚠ {{ error }}
        <div style="color: var(--text-dim); font-size: 12px; margin-top: 8px">
          请检查设置页中的 Base URL / API Key / 模型是否正确；接口需支持 OpenAI 风格的 /v1/images/generations。
        </div>
      </div>

      <img v-if="lastImage" class="ai-result" :src="lastImage" style="max-width: 480px" />
      <div v-if="lastImage" style="color: var(--text-dim); font-size: 12px; margin-top: 8px">
        已自动保存到图库，可前往「图库」页设为壁纸。
      </div>
    </div>
  </div>
</template>
