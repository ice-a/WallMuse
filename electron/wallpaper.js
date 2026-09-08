// 跨平台设置桌面壁纸 — Windows / macOS / Linux(GNOME,KDE,XFCE,Cinnamon,MATE,通用)
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err ? err.message : '') });
    });
  });
}

function detectLinuxDesktop() {
  const d = String(process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '').toLowerCase();
  if (d.includes('gnome') || d.includes('unity')) return 'gnome';
  if (d.includes('kde') || d.includes('plasma')) return 'kde';
  if (d.includes('xfce')) return 'xfce';
  if (d.includes('cinnamon')) return 'cinnamon';
  if (d.includes('mate')) return 'mate';
  return 'unknown';
}

const backendName = () => {
  if (process.platform === 'win32') return 'Windows SystemParametersInfo';
  if (process.platform === 'darwin') return 'macOS Finder / NSWorkspace';
  if (process.platform === 'linux') return `Linux (${detectLinuxDesktop()})`;
  return 'unsupported';
};

async function setWallpaperWin(imgPath) {
  // PowerShell P/Invoke SystemParametersInfoW(20, 0, path, 3)
  // 只接受 bmp/jpg/png；jpg/png 直接可用（Win10+）
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WP {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
[WP]::SystemParametersInfo(20, 0, "${imgPath.replace(/'/g, "''")}", 3) | Out-Null
if ($?) { Write-Output "OK" } else { Write-Output "FAIL" }`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 30000);
  return { ok: r.ok && r.stdout.includes('OK'), error: r.ok ? '' : r.stderr || r.stdout };
}

async function setWallpaperMac(imgPath) {
  // 方案1: osascript + Finder（对多桌面空间最稳）
  const script = `tell application "Finder" to set desktop picture to POSIX file "${imgPath}"`;
  let r = await run('osascript', ['-e', script]);
  if (r.ok) return { ok: true };
  // 方案2: sqlite WallpaperAgent（macOS 13+ 兜底较复杂，这里退回 defaults 方案）
  r = await run('defaults', ['write', 'com.apple.desktop', 'Background', `'{default = {ImageFilePath = "${imgPath}";};}'`]);
  await run('killall', ['Dock']);
  return { ok: r.ok, error: r.ok ? '' : r.stderr };
}

async function setWallpaperLinux(imgPath) {
  const de = detectLinuxDesktop();
  const uri = 'file://' + imgPath;
  switch (de) {
    case 'gnome':
    case 'cinnamon':
    case 'mate': {
      const schema = de === 'cinnamon' ? 'org.cinnamon.desktop.background'
        : de === 'mate' ? 'org.mate.background' : 'org.gnome.desktop.background';
      let r = await run('gsettings', ['set', schema, 'picture-uri', uri]);
      // GNOME 42+ 深色模式单独的键
      await run('gsettings', ['set', schema, 'picture-uri-dark', uri]);
      if (r.ok) return { ok: true };
      break;
    }
    case 'kde': {
      let r = await run('plasma-apply-wallpaperimage', [imgPath]);
      if (r.ok) return { ok: true };
      // fallback: qdbus script
      const script = `
var Wallpaper = require(\"org.kde.plasma.private.wallpaper\")
for (var i = 0; i < desktops().length; i++) {
  var d = desktops()[i]; d.wallpaperPlugin = \"org.kde.image\";
  d.wallpaperConfiguration = { Image: \"file://${imgPath}\" };
  d.reloadConfig();
}`;
      r = await run('qdbus', ['org.kde.plasmashell', '/PlasmaShell', 'org.kde.PlasmaShell.evaluateScript', script]);
      if (r.ok) return { ok: true };
      break;
    }
    case 'xfce': {
      // 对每个 monitor 属性设置
      const prop = await run('xfconf-query', ['-c', 'xfce4-desktop', '-l']);
      let okAny = false;
      if (prop.ok) {
        for (const line of prop.stdout.split('\n')) {
          if (line.includes('last-image')) {
            const r = await run('xfconf-query', ['-c', 'xfce4-desktop', '-p', line.trim(), '-s', imgPath]);
            if (r.ok) okAny = true;
          }
        }
      }
      if (okAny) return { ok: true };
      break;
    }
    default:
      break;
  }
  // 通用兜底：feh
  const feh = await run('feh', ['--bg-scale', imgPath]);
  if (feh.ok) return { ok: true };
  return { ok: false, error: `不支持当前桌面环境 (${de})，可安装 feh 后重试` };
}

async function set(imgPath) {
  if (!fs.existsSync(imgPath)) return { ok: false, error: '文件不存在: ' + imgPath };
  try {
    if (process.platform === 'win32') return await setWallpaperWin(imgPath);
    if (process.platform === 'darwin') return await setWallpaperMac(imgPath);
    if (process.platform === 'linux') return await setWallpaperLinux(imgPath);
    return { ok: false, error: '不支持的平台: ' + process.platform };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { set, backendName };
