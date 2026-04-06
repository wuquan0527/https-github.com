/**
 * ikuuu 自动签到（Surge 终版：自动探测真实接口 + 记忆成功URL）
 * - http-request: 抓 Cookie/Authorization
 * - cron/panel: 自动尝试多个候选接口，命中 JSON 即成功
 */

const CONFIG = {
  NAME: "ikuuu",
  DOMAIN: "ikuuu.org",
  TIMEOUT: 20,
  SILENT_ALREADY: false,
  CHECKIN_CANDIDATES: [
    "https://ikuuu.org/user/checkin?ajax=1",
    "https://ikuuu.org/user/_checkin",
    "https://ikuuu.org/api/v1/user/checkin",
    "https://ikuuu.org/user/checkin"
  ]
};

const KEY = {
  COOKIE: "ikuuu_cookie",
  AUTH: "ikuuu_auth",
  UA: "ikuuu_ua",
  LAST_OK_URL: "ikuuu_last_ok_checkin_url",
  LAST_TIME: "ikuuu_last_checkin_time"
};

(function () {
  if (typeof $request !== "undefined") {
    return capture();
  } else {
    return checkin();
  }
})();

// ===== 抓凭证 =====
function capture() {
  try {
    const url = $request.url || "";
    if (!url.includes(CONFIG.DOMAIN)) return $done({});

    const h = lowerHeaders($request.headers || {});
    const cookie = h["cookie"] || "";
    const auth = h["authorization"] || "";
    const ua = h["user-agent"] || "Mozilla/5.0";

    let saved = [];
    if (cookie) { $persistentStore.write(cookie, KEY.COOKIE); saved.push("Cookie"); }
    if (auth) { $persistentStore.write(auth, KEY.AUTH); saved.push("Authorization"); }
    if (ua) $persistentStore.write(ua, KEY.UA);

    if (saved.length) {
      console.log(`[${CONFIG.NAME}] 凭证已保存: ${saved.join("/")}`);
      $notification.post(CONFIG.NAME, "凭证获取成功", `已保存: ${saved.join(" / ")}`);
    }
  } catch (e) {
    console.log(`[${CONFIG.NAME}] capture error: ${e}`);
  }
  $done({});
}

// ===== 签到 =====
function checkin() {
  const cookie = $persistentStore.read(KEY.COOKIE) || "";
  const auth = $persistentStore.read(KEY.AUTH) || "";
  const ua = $persistentStore.read(KEY.UA) || "Mozilla/5.0 Surge Script";

  if (!cookie && !auth) {
    $notification.post(CONFIG.NAME, "签到失败", "未找到凭证，请先访问 ikuuu 网站抓取");
    return $done();
  }

  // 把上次成功接口放最前
  const last = $persistentStore.read(KEY.LAST_OK_URL) || "";
  let urls = CONFIG.CHECKIN_CANDIDATES.slice();
  if (last && urls.includes(last)) {
    urls = [last].concat(urls.filter(u => u !== last));
  }

  console.log(`[${CONFIG.NAME}] 开始签到，候选接口数量: ${urls.length}`);

  tryUrl(0);

  function tryUrl(idx) {
    if (idx >= urls.length) {
      $notification.post(CONFIG.NAME, "签到失败", "所有候选接口均失败（返回HTML/404/非JSON）");
      return $done();
    }

    const url = urls[idx];
    console.log(`[${CONFIG.NAME}] 尝试接口: ${url}`);

    const headers = {
      "User-Agent": ua,
      "Accept": "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Origin": "https://ikuuu.org",
      "Referer": "https://ikuuu.org/user"
    };
    if (cookie) headers["Cookie"] = cookie;
    if (auth) headers["Authorization"] = auth;

    const req = { url, headers, body: "", timeout: CONFIG.TIMEOUT };

    $httpClient.post(req, (err, resp, data) => {
      const code = resp ? resp.status : 0;
      const txt = String(data || "");
      console.log(`[${CONFIG.NAME}] ${url} -> HTTP ${code}, body预览: ${txt.slice(0, 80)}`);

      if (err) return tryUrl(idx + 1);

      // 非200先继续尝试
      if (code !== 200) return tryUrl(idx + 1);

      // 返回HTML说明是页面路由，不是接口
      if (/^\s*<!DOCTYPE html>|^\s*<html/i.test(txt)) return tryUrl(idx + 1);

      // 只接受JSON
      let j = null;
      try { j = JSON.parse(txt); } catch (_) { return tryUrl(idx + 1); }

      // 命中成功接口，保存
      $persistentStore.write(url, KEY.LAST_OK_URL);

      const msg = j.msg || j.message || (typeof j.data === "string" ? j.data : "") || "完成";
      const lower = msg.toLowerCase();

      if (/已签到|已经签到|already/.test(lower)) {
        if (!CONFIG.SILENT_ALREADY) {
          $notification.post(CONFIG.NAME, "今日已签到", msg);
        }
        return $done();
      }

      const success = j.ret === 1 || j.success === true || /成功|success|获得/.test(lower);
      if (!success) {
        $notification.post(CONFIG.NAME, "签到结果", truncate(msg || txt, 120));
        return $done();
      }

      $persistentStore.write(new Date().toISOString(), KEY.LAST_TIME);
      $notification.post(CONFIG.NAME, "签到成功", `${msg}\n接口: ${url}`);
      $done();
    });
  }
}

// ===== utils =====
function lowerHeaders(h) {
  const o = {};
  Object.keys(h).forEach(k => o[k.toLowerCase()] = h[k]);
  return o;
}
function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "..." : s;
}

/**
 * Surge 配置（示例）
 *
 * [Script]
 * ikuuu-Cookie-Capture = type=http-request,pattern=^https?:\/\/([a-zA-Z0-9-]+\.)*ikuuu\.org\/.*,requires-body=0,script-path=https://raw.githubusercontent.com/wuquan0527/https-github.com/main/ikuuu_checkin.js
 * ikuuu-Auto-Checkin = type=cron,cronexp=5 9 * * *,wake-system=1,timeout=30,script-path=https://raw.githubusercontent.com/wuquan0527/https-github.com/main/ikuuu_checkin.js
 *
 * [Panel]
 * ikuuu-手动签到 = script-name=ikuuu-Auto-Checkin,update-interval=0
 *
 * [MITM]
 * hostname = ikuuu.org, *.ikuuu.org
 */
