// 苹果CMS V10（MacCMS）资源站 API 客户端 — 搜索 / 详情 / 剧集解析
// 本文件不含具体采集站地址：CMS 接口列表由设置提供（wallmuse-config 导入或用户添加）。
// 标准 API: {base}?ac=detail&wd=关键词&pg=页码 / {base}?ac=detail&ids=id
// vod_play_url 形如 "第01集$http://..../index.m3u8#第02集$http://....m3u8"
const http = require("http");
const https = require("https");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * 内置苹果CMS V10 资源站预设（公开采集接口，可在设置中再添加自定义站）。
 * 仅为标准 MacCMS V10 provide 接口基址，不含任何播放地址；播放地址由接口实时返回。
 * 部分站点有访问频率/地区限制，可用「影视」页的「＋ 添加并测试」自行校验。
 */
const PRESETS = [
  { name: "量子资源", url: "https://cj.lziapi.com/api.php/provide/vod" },
  { name: "最大资源", url: "https://api.zuidapi.com/api.php/provide/vod" },
  { name: "非凡资源", url: "https://api.ffzyapi.com/api.php/provide/vod" },
];

/** 返回内置预设站列表（按 url 去重） */
function presets() {
  const seen = new Set();
  return PRESETS.filter((x) => {
    if (!x.url || seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });
}

function getJson(urlStr, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.request(
      u,
      {
        timeout,
        headers: { "User-Agent": UA, Accept: "application/json,*/*" },
      },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume();
          return resolve(
            getJson(new URL(res.headers.location, urlStr).href, timeout),
          );
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error("响应不是 JSON（可能不是标准 CMS 接口）"));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.end();
  });
}

/** 规范化 API 基址：去尾部 / 和 ?，参数统一拼接 */
function normBase(api) {
  return String(api || "")
    .trim()
    .replace(/[/?]+$/, "");
}

/** 把 vod_play_url 拆成剧集列表；多播放组($$$分隔)时取组名一起返回 */
function parsePlayUrls(vodPlayFrom, vodPlayUrl) {
  const groups = String(vodPlayUrl || "").split("$$$");
  const froms = String(vodPlayFrom || "").split("$$$");
  const out = [];
  groups.forEach((g, gi) => {
    const segs = String(g || "")
      .split("#")
      .map((x) => x.trim())
      .filter(Boolean);
    const eps = segs
      .map((seg, i) => {
        const idx = seg.indexOf("$");
        if (idx >= 0) {
          const name = seg.slice(0, idx).trim();
          const url = seg.slice(idx + 1).trim();
          if (!(url.startsWith("http://") || url.startsWith("https://")))
            return null;
          return { name: name || "第" + (i + 1) + "集", url };
        }
        // 无 $ 分隔：整段即播放地址（部分站点整部为单一直链，如 .../playlist.m3u8）
        if (seg.startsWith("http://") || seg.startsWith("https://"))
          return { name: "第" + (i + 1) + "集", url: seg };
        return null;
      })
      .filter(Boolean);
    if (eps.length)
      out.push({ from: (froms[gi] || `线路${gi + 1}`).trim(), episodes: eps });
  });
  return out;
}

function normVod(v) {
  const plays = parsePlayUrls(v.vod_play_from, v.vod_play_url);
  return {
    id: String(v.vod_id ?? v.id ?? ""),
    name: v.vod_name || "未命名",
    pic: v.vod_pic || "",
    remarks: v.vod_remarks || "",
    class: v.vod_class || v.type_name || "",
    year: v.vod_year || "",
    area: v.vod_area || "",
    actor: (v.vod_actor || "")
      .split(",")
      .filter(Boolean)
      .slice(0, 4)
      .join(" / "),
    director: (v.vod_director || "")
      .split(",")
      .filter(Boolean)
      .slice(0, 2)
      .join(" / "),
    blurb: v.vod_blurb || "",
    content: String(v.vod_content || "")
      .replace(/<[^>]+>/g, "")
      .trim()
      .slice(0, 500),
    plays,
  };
}

/**
 * 搜索（ac=detail 带播放地址）
 * @returns { ok, items, page, pageCount, total, error? }
 */
async function search({ api, wd = "", pg = 1 }) {
  const base = normBase(api);
  if (!/^https?:\/\//.test(base))
    return { ok: false, error: "请输入 http(s) 开头的 CMS 采集接口地址" };
  try {
    const q = new URLSearchParams({ ac: "detail", pg: String(pg) });
    if (wd) q.set("wd", wd);
    const j = await fetchJsonAny(buildCandidates(base, q));
    if (Number(j.code) !== 1 && j.code !== undefined && Number(j.code) !== 0) {
      return { ok: false, error: `接口返回 code=${j.code} ${j.msg || ""}` };
    }
    const list = Array.isArray(j.list) ? j.list : [];
    return {
      ok: true,
      items: list.map(normVod),
      page: Number(j.page) || pg,
      pageCount: Number(j.pagecount) || 1,
      total: Number(j.total) || list.length,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** 按 id 取详情（部分站搜索结果已含播放地址，此处兜底） */
async function detail({ api, id }) {
  const base = normBase(api);
  try {
    const j = await fetchJsonAny(
      buildCandidates(
        base,
        new URLSearchParams({ ac: "detail", ids: String(id) }),
      ),
    );
    const v = Array.isArray(j.list) && j.list[0];
    if (!v) return { ok: false, error: "未找到该片目" };
    return { ok: true, vod: normVod(v) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** 连通测试：拉第一页验证接口可用 */
async function test(api) {
  const r = await search({ api, wd: "", pg: 1 });
  if (r.ok) return { ok: true, hint: `接口可用，共 ${r.total} 部资源` };
  return { ok: false, hint: r.error };
}

// 采集接口常位于 /provide/vod 子路径（如 xxx/api.php/provide/vod）。
// 基址不含 provide 时额外尝试该子路径，兼容只填到 /api.php 的站点。
function buildCandidates(base, q) {
  const cands = [base + "/?" + q];
  if (!base.toLowerCase().includes("provide")) {
    cands.push(base + "/provide/vod?" + q);
  }
  return cands;
}
async function fetchJsonAny(cands) {
  let lastErr;
  for (const u of cands) {
    try {
      return await getJson(u);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("接口无可用响应");
}
module.exports = { search, detail, test, presets };
