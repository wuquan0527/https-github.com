/**
 * ikuuu 自动签到（Surge 最终版）
 * - http-request: 抓取 Cookie / Authorization
 * - cron: 定时签到（固定接口 /user/checkin）
 */

const CONFIG = {
  NAME: "ikuuu",
  DOMAIN: "ikuuu.org",
  CHECKIN_URL: "https://ikuuu.org/user/checkin", // ✅ 你日志已确认
  USER_INFO_URL: "", // 不确定可留空；后续抓到再填
  TIMEOUT: 15,
  SILENT_ALREADY: false, // 已签到是否静默
};

const KEY = {
  COOKIE: "ikuuu_cookie",
  AUTH: "ikuuu_auth",
  UA: "ikuuu_ua",
  LAST: "ikuuu_last_checkin",
};

(function () {
  if (typeof $request !== "undefined") {
    captureCredential();
  } else {
    runCheckin();
  }
})();

// ===== 1) 抓凭证 =====
function captureCredential() {
  try {
    const url = $request.url || "";
    if (!url.includes(CONFIG.DOMAIN)) return $done({});

    const headers = lowerHeaders($request.headers || {});
    const cookie = headers["cookie"] || "";
    const auth = headers["authorization"] || "";
    const ua = headers["user-agent"] || "Mozilla/5.0";

    let saved = [];
    if (cookie) {
      $persistentStore.write(cookie, KEY.COOKIE);
      saved.push("Cookie");
      console.log(`[${CONFIG.NAME}] Cookie 已保存`);
    }
    if (auth) {
      $persistentStore.write(auth, KEY.AUTH);
      saved.push("Authorization");
      console.log(`[${CONFIG.NAME}] Authorization 已保存`);
    }
    $persistentStore.write(ua, KEY.UA);

    if (saved.length > 0) {
      $notification.post(CONFIG.NAME, "凭证获取成功", `已保存: ${saved.join(" / ")}`);
    }
  } catch (e) {
    console.log(`[${CONFIG.NAME}] capture error: ${e}`);
  }
  $done({});
}

// ===== 2) 定时签到 =====
function runCheckin() {
  const cookie = $persistentStore.read(KEY.COOKIE) || "";
  const auth = $persistentStore.read(KEY.AUTH) || "";
  const ua = $persistentStore.read(KEY.UA) || "Mozilla/5.0 Surge Script";

  if (!cookie && !auth) {
    $notification.post(CONFIG.NAME, "签到失败", "未找到凭证，请先访问 ikuuu 网站抓取 Cookie");
    return $done();
  }

  const headers = {
    "User-Agent": ua,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Origin: "https://ikuuu.org",
    Referer: "https://ikuuu.org/user",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (cookie) headers["Cookie"] = cookie;
  if (auth) headers["Authorization"] = auth;

  const req = {
    url: CONFIG.CHECKIN_URL,
    headers,
    body: "", // /user/checkin 常见为表单空体
    timeout: CONFIG.TIMEOUT,
  };

  console.log(`[${CONFIG.NAME}] 开始签到: ${CONFIG.CHECKIN_URL}`);

  $httpClient.post(req, (err, resp, data) => {
    if (err) {
      console.log(`[${CONFIG.NAME}] 网络错误: ${err}`);
      $notification.post(CONFIG.NAME, "签到失败", `网络错误: ${err}`);
      return $done();
    }

    const status = resp ? resp.status : 0;
    const text = String(data || "");
    console.log(`[${CONFIG.NAME}] HTTP ${status}`);
    console.log(`[${CONFIG.NAME}] 响应: ${truncate(text, 300)}`);

    if (status === 401 || status === 403) {
      $notification.post(CONFIG.NAME, "签到失败", `凭证失效(HTTP ${status})，请重新抓取`);
      return $done();
    }
    if (status === 404) {
      $notification.post(CONFIG.NAME, "签到失败", "接口 404，请确认站点是否改版");
      return $done();
    }
    if (status !== 200) {
      $notification.post(CONFIG.NAME, "签到失败", `HTTP ${status} ${truncate(text, 80)}`);
      return $done();
    }

    // 兼容 JSON / 纯文本
    const j = toJSON(text);
    const msg = j
      ? (j.msg || j.message || (typeof j.data === "string" ? j.data : "") || "")
      : text;

    if (/已签到|已经签到|already/i.test(msg)) {
      if (!CONFIG.SILENT_ALREADY) {
        $notification.post(CONFIG.NAME, "今日已签到", msg || "无需重复签到");
      }
      return $done();
    }

    if (/成功|success|获得|完成/i.test(msg) || (j && (j.ret === 1 || j.success === true))) {
      const gain = parseGain(msg) || "成功（未返回具体流量）";
      $persistentStore.write(new Date().toISOString(), KEY.LAST);
      $notification.post(CONFIG.NAME, "签到成功", `签到流量: ${gain}\n${msg || ""}`);
      return $done();
    }

    $notification.post(CONFIG.NAME, "签到结果未知", truncate(msg || text, 120));
    $done();
  });
}

// ===== 工具函数 =====
function lowerHeaders(h) {
  const out = {};
  Object.keys(h || {}).forEach((k) => (out[k.toLowerCase()] = h[k]));
  return out;
}
function toJSON(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}
function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "..." : s;
}
function parseGain(msg) {
  const m = String(msg || "").match(/([+\-]?\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|KiB|MiB|GiB|TiB)/i);
  return m ? `${m[1]} ${m[2].toUpperCase()}` : "";
}

/**
 * ===== Surge 配置示例 =====
 *
 * [Script]
 * ikuuu-Cookie-Capture = type=http-request,pattern=^https?:\/\/([a-zA-Z0-9-]+\.)*ikuuu\.org\/.*,requires-body=0,script-path=https://raw.githubusercontent.com/wuquan0527/https-github.com/main/ikuuu_checkin.js
 * ikuuu-Auto-Checkin = type=cron,cronexp=5 9 * * *,wake-system=1,timeout=30,script-path=https://raw.githubusercontent.com/wuquan0527/https-github.com/main/ikuuu_checkin.js
 *
 * [MITM]
 * hostname = ikuuu.org, *.ikuuu.org
 */
