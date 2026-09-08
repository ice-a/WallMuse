// .env 配置文件 — 敏感信息（AI Key、自定义源接口）统一存放于 数据目录/.env
// 不写入 library.json，避免随图库数据 / 备份泄露；迁移数据目录时随行。
// 规则：
//   - 仅管理 WALLMUSE_ 前缀键（KEY=VALUE，取第一个 = 之后的所有内容为值，不做转义）
//   - 文件中的注释与其他行原样保留
//   - 真实系统环境变量（同名 WALLMUSE_*）优先于文件值
const fs = require('fs');

const PREFIX = 'WALLMUSE_';

class EnvFile {
  constructor(file) {
    this.file = file;
    this.lines = [];
    this.load();
  }

  load() {
    this.lines = [];
    try {
      if (fs.existsSync(this.file)) this.lines = fs.readFileSync(this.file, 'utf8').split(/\r?\n/);
    } catch { /* 读取失败视为空文件 */ }
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

  /** 写入/更新键，保留文件中其他行与注释（原子写） */
  set(patch) {
    for (const [k, v] of Object.entries(patch)) {
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
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.lines.join('\n'));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { EnvFile, PREFIX };
