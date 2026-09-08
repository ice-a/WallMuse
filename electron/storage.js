// 数据存储位置管理 — userData/wallmuse-data.json 记录数据目录，支持整体迁移
// 数据目录内含: library.json / library/(图库副本) / downloads/ / generated/
const fs = require('fs');
const path = require('path');

const MANAGED = ['library.json', 'library', 'downloads', 'generated']; // 迁移范围

class Storage {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.cfgFile = path.join(userDataDir, 'wallmuse-data.json');
    this.cfg = { dataDir: userDataDir, configured: false };
    try {
      if (fs.existsSync(this.cfgFile)) this.cfg = { ...this.cfg, ...JSON.parse(fs.readFileSync(this.cfgFile, 'utf8')) };
    } catch { /* 损坏回退默认 */ }
    this.cfg.dataDir = this.cfg.dataDir || userDataDir;
  }

  get dataDir() { return this.cfg.dataDir; }
  get configured() { return !!this.cfg.configured; }
  get defaultDir() { return this.userDataDir; }

  _save() {
    const tmp = this.cfgFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.cfg, null, 2));
    fs.renameSync(tmp, this.cfgFile);
  }

  status() {
    const libFile = path.join(this.dataDir, 'library.json');
    let itemCount = 0, sizeBytes = 0;
    try {
      const j = JSON.parse(fs.readFileSync(libFile, 'utf8'));
      itemCount = (j.items || []).length;
      for (const it of j.items || []) sizeBytes += Number(it.size) || 0;
    } catch { /* 尚无库文件 */ }
    return {
      configured: this.configured,
      dataDir: this.dataDir,
      defaultDir: this.defaultDir,
      exists: fs.existsSync(this.dataDir),
      itemCount, sizeBytes,
    };
  }

  /** 标记使用某目录（不做迁移，首启向导用） */
  useDir(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      return { ok: false, error: '目录不可写：' + dir };
    }
    this.cfg.dataDir = dir;
    this.cfg.configured = true;
    this._save();
    return { ok: true };
  }

  /** 迁移到新目录：复制托管数据 → 重写 item 路径 → 切换配置 */
  migrate(newDir) {
    const oldDir = this.dataDir;
    if (path.normalize(newDir) === path.normalize(oldDir)) {
      this.cfg.configured = true;
      this._save();
      return { ok: true, moved: 0, status: this.status() };
    }
    try {
      fs.mkdirSync(newDir, { recursive: true });
      fs.accessSync(newDir, fs.constants.W_OK);
    } catch {
      return { ok: false, error: '目标目录不可写：' + newDir };
    }
    let moved = 0;
    try {
      for (const name of MANAGED) {
        const src = path.join(oldDir, name);
        if (!fs.existsSync(src)) continue;
        copyRecursive(src, path.join(newDir, name));
        moved++;
      }
      // 重写 library.json 中 item.path（指向 old library/ → new library/）
      const libNew = path.join(newDir, 'library.json');
      if (fs.existsSync(libNew)) {
        const j = JSON.parse(fs.readFileSync(libNew, 'utf8'));
        for (const it of j.items || []) {
          if (it.path && it.path.startsWith(oldDir)) it.path = path.join(newDir, it.path.slice(oldDir.length));
        }
        const tmp = libNew + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
        fs.renameSync(tmp, libNew);
      }
    } catch (e) {
      return { ok: false, error: '迁移失败（原数据未删除，可重试）：' + String(e.message || e) };
    }
    this.cfg.dataDir = newDir;
    this.cfg.configured = true;
    this._save();
    return { ok: true, moved, status: this.status() };
  }
}

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copyRecursive(path.join(src, name), path.join(dest, name));
  } else {
    fs.copyFileSync(src, dest);
  }
}

module.exports = { Storage };
