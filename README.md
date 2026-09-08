# WallMuse · 缪斯壁库

> **by 爱喝水的木子**

跨平台桌面灵感套件 · **Electron + Vue 3**（壁纸功能思路参考 [Wallspace](https://github.com/1parado/Wallspace)）

支持 **Windows / macOS / Linux**。

## 功能

- **图库管理** — 本地导入（文件选择器）、在线下载、AI 生图统一入库；收藏、标签、集合、搜索；删除进系统回收站可找回
- **一键设壁纸** — 双击卡片或预览页点击「设为壁纸」
  - Windows：`SystemParametersInfo`（PowerShell P/Invoke）
  - macOS：Finder / osascript
  - Linux：自动适配 GNOME / KDE / XFCE / Cinnamon / MATE，兜底 `feh`
- **发现（多源可切换）**
  - **Bing 每日** ⭐ 主力源：官方 `HPImageArchive` API，国内直连（cn.bing.com 主用 / www.bing.com 备用自动切换），每页 8 张带版权描述，归档 2 页，一键下载入库
  - **随机抓取** — 并发抓取随机壁纸（LoliApi → Alcy → Paugram 自动降级，支持 302 跳转），桌面横屏 / 手机竖屏，6/12/24 张可选，抓到即入库 + MD5 去重
  - **Wallhaven** — 公开 API 搜索（SFW），热门 / 最多收藏 / 随机，**颜色筛选（28 官方色板）+ 最低分辨率筛选**，分页浏览；注意 wallhaven.cc 国内通常无法直连
  - **接口内容源（图片 / 文字 / 视频）** — 内置图片壁纸源、文字语录源、随机短视频源（清单见 `wallmuse-sources.json` 配置包）；图片批量抓取自动入库，文字一键复制，视频解析后在线播放；**支持添加自定义源**（直跳 / 直链文本 / JSON 取字段三种模式，先测后存）
- **AI 生图** — 兼容 OpenAI `/v1/images/generations` 接口，**多模型预设管理**（添加多个 Base URL / API Key / 模型组合，一键设默认，创作页随时切换），b64 与 url 双回退，支持连接测试；生成结果自动入库；旧版单配置自动迁移为预设
- **AI 对话** — OpenAI 兼容 `/v1/chat/completions` 流式对话：填 Base URL + Key 后可**一键拉取模型列表**选择（也可手填模型名），支持**连通测试**；多轮上下文、复制、清空，历史记录持久化
- **AI 小说创作** — 小说工作台：大纲、设定、章节逐章流式生成，章节摘要衔接上下文，多部小说独立保存
- **音乐** — 网易云开放接口（免登录）+ Meting 聚合接口搜索、在线播放、歌词滚动显示；支持添加自定义 API 站点，先测后存
- **影视（CMS 资源站）** — 苹果CMS V10 采集接口搜索影视剧集，详情展示海报简介，多线路剧集列表，**hls.js 播放 m3u8，并支持 DASH(.mpd) / FLV(.flv) / MP4 等直链格式**，支持复制播放地址 / 浏览器打开；可添加自定义站点
- **数据存储位置可配置** — 首次启动向导选择数据目录（图库 / 下载 / AI 记录存放处），之后可在设置页**整体迁移**到新位置（自动改写图库路径，原数据保留兜底）
- **配置备份** — 源 / 接口 / 模型等设置一键导出为 `wallmuse-config` JSON，可文件或 URL 方式导入（`wallmuse-sources.json` 即内置全部第三方源的配置包，可自行托管后应用内导入）
- **定时轮换** — 按间隔（分钟）从图库随机自动换壁纸
- **随机换一张** — 从当前筛选结果随机设为壁纸


## 基础配置

应用的全部偏好（模型预设、内容源、影视 / 音乐接口、随机源、功能端点等）都可在「设置」页内配置，也可通过 `wallmuse-config` 备份 / 导入一键迁移。仓库内置 `wallmuse-config.example.json` 作为**结构参考模板——不含任何真实密钥或源地址，全部为占位符**，请按需替换后再导入。

### 配置项速览

| 配置键 | 说明 |
| --- | --- |
| `theme` / `autoRotate` / `rotateMinutes` / `rotateFilter` | 外观与定时轮换偏好 |
| `aiPresets` / `aiActive` | AI 生图预设（OpenAI 兼容 `/v1/images/generations`） |
| `chatPresets` / `chatActive` / `chatAgents` / `chatAgent` | AI 对话预设与自定义 Agent |
| `customSources` / `builtinSources` | 接口内容源 `{ image, text, video }`，条目 `{ id, name, url, kind, target }` |
| `randomChains` | 随机壁纸端点 `{ desktop, mobile }` |
| `endpoints` | 功能接口 `{ wallhaven, bing[], netease }` |
| `cmsApis` | 影视 CMS 采集接口（苹果CMS V10） |
| `musicApis` | 音乐源（Meting / 网易云类） |

### 导入示例配置

1. 复制 `wallmuse-config.example.json`，把占位符替换为自己的地址 / 密钥
2. 「设置 → 备份与导入 → 导入文件」选择该 JSON
3. 或把修改后的副本托管到可访问 URL，用「从 URL 导入」加载

> 影视采集接口为公开第三方 MacCMS V10 资源站，应用内置若干预设（见「影视」页站点下拉）。部分站点有访问频率 / 地区限制，建议用「＋ 添加并测试」校验可用性，或自备可直连的采集站。

## 开发

```bash
npm install          # 国内环境：npm install --registry=https://registry.npmmirror.com
npm run dev          # 只启动前端热更新（Vite :5173）
npm run dev:electron # 构建前端 + 启动桌面应用
```

根目录的 `test-apis.js` / `test-sources.js` / `test-music.js` 为接口实测脚本（`node test-apis.js` 直接运行）。

## 构建与分发

```bash
npm run build:linux  # Linux：AppImage + deb
npm run build:win    # Windows：NSIS 安装包 + 便携版 exe
npm run build:mac    # macOS：DMG（x64 + arm64）
```

### 跨平台分发的正确姿势

Electron 应用**必须在对应操作系统上打包**（macOS 打包 DMG 只能在 macOS 上进行）。
推荐用仓库内置的 GitHub Actions 工作流一键产出三平台安装包：

1. 把本项目推送到 GitHub 仓库
2. 打 tag 触发自动构建并发布到 Releases：
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. 或在 GitHub → Actions → **Release** → Run workflow 手动触发，从 Artifacts 下载：
   - Windows：`WallMuse Setup 1.0.0.exe`（安装版）/ `WallMuse 1.0.0.exe`（便携版）
   - macOS：`WallMuse.dmg`（Intel + Apple Silicon）
   - Linux：`WallMuse.AppImage` / `wallmuse_amd64.deb`

> macOS 分发说明：未签名/未公证的 DMG，接收方首次打开需右键 → 打开（绕过 Gatekeeper）。如需正式分发，在 CI 中配置 `CSC_LINK` / `APPLE_ID` 等环境变量签名公证。

### Windows 本地打包（无需 CI）

在装有 Node.js 18+ 的 Windows 机器上：

```powershell
git clone <你的仓库>
cd wallmuse
npm install
npm run build:win
# 产物在 release\ 目录
```

## 验证清单

- ✅ 全部主进程模块通过 `node --check` 语法检查
- ✅ `vite build` 前端构建通过
- ✅ `test-apis.js` 接口内容源实测：图片 / 文字 / 视频源可用性验证（结果见 `api-report.json`）
- ✅ `test-sources.js` 内置源配置与降级链验证
- ✅ `test-music.js` 音乐接口实测：搜索 / 播放地址 / 歌词

## 目录结构

```
wallmuse/
├── electron/          # 主进程
│   ├── main.js        # 入口：窗口、IPC、协议、定时轮换、配置导入导出
│   ├── wallpaper.js   # 跨平台设壁纸（Win/macOS/Linux）
│   ├── library.js     # 图库存储（JSON 原子写）
│   ├── wallhaven.js   # Wallhaven 搜索/下载
│   ├── bing.js        # Bing 每日壁纸（国内直连，双域名降级）
│   ├── randomsrc.js   # 随机壁纸多端点降级抓取（302 重定向 + MD5 去重）
│   ├── apisrc.js      # 接口内容源：图片批量/文字/视频 + 自定义源（direct/texturl/json）
│   ├── cms.js         # 苹果CMS V10 资源站搜索/详情/剧集解析
│   ├── music.js       # 音乐：网易云开放接口 + Meting 聚合（搜索/播放/歌词）
│   ├── chat.js        # OpenAI 兼容对话（SSE 流式 + 模型列表）
│   ├── ai.js          # OpenAI 兼容生图
│   ├── storage.js     # 数据存储位置管理与整体迁移
│   ├── env.js         # 数据目录 WALLMUSE_ 配置文件管理（系统环境变量优先）
│   └── preload.js     # contextBridge 安全桥（window.wallmuse）
├── src/               # Vue 3 渲染进程
│   ├── App.vue        # 导航 + 首启存储向导
│   └── components/    # 图库 / 发现 / 影视 / 音乐 / 小说 / AI 对话 / AI 创作 / 设置 / 预览
├── .github/workflows/release.yml  # 三平台 CI 构建发版
└── build/             # 图标与构建资源
```
