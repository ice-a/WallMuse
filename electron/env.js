// .env 配置文件 — 敏感信息（AI Key、自定义源接口）统一存放于 数据目录/.env
// 不写入 library.json，避免随图库数据 / 备份泄露；迁移数据目录时随行。
// 规则：
//   - 仅管理 WALLMUSE_ 前缀键（KEY=VALUE，取第一个 = 之后的所有内容为值，不做转义）
//   - 文件中的注释与其他行原样保留
//   - 真实系统环境变量（同名 WALLMUSE_*）优先于文件值
//   - 文件不存在时自动生成默认模板（含全部支持键的说明与默认值）
const fs = require('fs');

const PREFIX = 'WALLMUSE_';

// 默认模板：新增键时在此同步登记（注释行 = 可选默认值；裸行 = 应用托管的结构化配置）
const DEFAULT_TEMPLATE = `# WallMuse 配置文件（数据目录/.env）
# ——— 规则 ———
# · 一行一项，格式 KEY=VALUE；以 # 开头的行为注释
# · 复杂结构的值用 JSON 表示（数组 / 对象）
# · 同名真实系统环境变量（WALLMUSE_*）优先于本文件
# · 「设置」页可直接编辑本文件，应用内保存源/密钥配置时也会自动写回这里
# · 删除本文件后重启应用会重新生成默认模板

# ---------- 应用默认值（取消注释即生效，优先于设置界面保存的值） ----------
# WALLMUSE_autoRotate=0            # 启动即启用定时轮换：1=开 0=关
# WALLMUSE_rotateMinutes=30        # 轮换间隔（分钟，1-1440）

# ---------- 接口密钥 ----------
# WALLMUSE_wallhavenApiKey=        # Wallhaven API Key（搜索请求自动附带 apikey 参数）

# ---------- 源与接口配置（应用托管，JSON 格式；应用内保存后自动写回） ----------
WALLMUSE_aiPresets=[]
WALLMUSE_cmsApis=[]
WALLMUSE_musicApis=[]
WALLMUSE_customSources={"image":[],"text":[],"video":[]}
WALLMUSE_builtinSources={"image":[],"text":[],"video":[]}
WALLMUSE_randomChains={"desktop":[],"mobile":[]}
WALLMUSE_endpoints={}
`;

class EnvFile {
  /**
   * @param {string} file .env 文件路径
   * @param {string[]} [knownKeys] 不带前缀的已知键名（用于旧版本无前缀行的自动迁移）
   */
  constructor(file, knownKeys = []) {
    this.file = file;
    this.knownKeys = new Set(knownKeys);
    this.lines = [];
    this.load();
  }

  load() {
    this.lines = [];
    let dirty = false;
    try {
      if (fs.existsSync(this.file)) this.lines = fs.readFileSync(this.file, 'utf8').split(/\r?\n/);
    } catch { /* 读取失败视为空文件 */ }
    // 旧版本迁移：已知键的无前缀行（如 aiPresets=…）补上 WALLMUSE_ 前缀，避免读取时被忽略
    this.lines = this.lines.map((l) => {
      const t = l.trim();
      const i = t.indexOf('=');
      if (i > 0 && !t.startsWith('#') && !t.slice(0, i).trim().startsWith(PREFIX)
          && this.knownKeys.has(t.slice(0, i).trim())) {
        dirty = true;
        return PREFIX + l;
      }
      return l;
    });
    if (dirty) this.saveLines();
    else if (!this.lines.length) this.ensureDefaults();
  }

  exists() { return fs.existsSync(this.file); }

  /** 全部 WALLMUSE_ 键值（系统环境变量优先于文件） */
  getAll() {
    const out = {};
    for (const line of this.lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      if (k.startsWith(PREFIX)) out[k] = t.slice(i + 1).trim();
    }
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith(PREFIX) && v != null && v !== '') out[k] = v;
    }
    return out;
  }

  /** 写入/更新键，保留文件中其他行与注释（原子写）；无前缀键自动补前缀 */
  set(patch) {
    for (const [rawK, v] of Object.entries(patch)) {
      const k = rawK.startsWith(PREFIX) ? rawK : PREFIX + rawK;
      const line = `${k}=${v}`;
      const idx = this.lines.findIndex((l) => {
        const t = l.trim();
        return t.startsWith(k + '=') || t === k;
      });
      if (idx >= 0) this.lines[idx] = line;
      else {
        if (this.lines.length && this.lines[this.lines.length - 1].trim() !== '') this.lines.push('');
        this.lines.push(line);
      }
    }
    this.saveLines();
  }

  /** 整文件覆盖写（设置页编辑器用，原子写） */
  writeRaw(text) {
    this.lines = String(text).split(/\r?\n/);
    this.saveLines();
  }

  readRaw() {
    let text = '';
    try { if (fs.existsSync(this.file)) text = fs.readFileSync(this.file, 'utf8'); } catch { /* 视为空 */ }
    return { path: this.file, exists: fs.existsSync(this.file), text };
  }

  /** 用默认模板覆盖当前文件 */
  resetToTemplate() { this.writeRaw(DEFAULT_TEMPLATE); }

  /** 文件不存在时生成默认模板 */
  ensureDefaults() {
    if (fs.existsSync(this.file)) return;
    this.writeRaw(DEFAULT_TEMPLATE);
  }

  saveLines() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.lines.join('\n'));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { EnvFile, PREFIX, DEFAULT_TEMPLATE };
