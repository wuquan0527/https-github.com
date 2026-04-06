/**
 * ikuuu 自动签到（精简最终版，不静默已签到）
 * - 访问网页时自动抓取 Cookie/Authorization
 * - 支持 cron 和面板按钮手动触发
 */

const CONFIG = {
  NAME: "ikuuu",
  DOMAIN: "ikuuu.org",
  CHECKIN_URL: "https://ikuuu.org/user/checkin?ajax=1",
  TIMEOUT: 20,
};

const KEY = {
  COOKIE: "ikuuu_cookie",
  AUTH: "ikuuu_auth",
  UA: "ikuuu_ua",
  LAST: "ikuuu_last_checkin_time",
};

(function () {
  if (typeof $request !== "undefined") {
    captureCredential();
  } else {
    doCheckin();
  }
})();

// ===== 抓凭证 =====
function captureCredential() {
  try {
    const url = $request.url || "";
    if (!url.includes(CONFIG.DOMAIN)) return $done({});

    const h = lowerHeaders($request.headers || {});
    const cookie = h["cookie"] || "";
    const auth = h["authorization"] || "";
    const ua = h["user-agent"] || "Mozilla/5.0";

    let saved = [];
    if (cookie) {
      $persistentStore.write(cookie, KEY.COOKIE);
      saved.push("Cookie");
    }
    if (auth) {
      $persistentStore.write(auth, KEY.AUTH);
      saved.push("Authorization");
    }
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
function doCheckin() {
  const cookie = $persistentStore.read(KEY.COOKIE) || "";
  const auth = $persistentStore.read(KEY.AUTH) || "";
  const ua = $persistentStore.read(KEY.UA) || "Mozilla/5.0 Surge Script";

  if (!cookie && !auth) {
    $notification.post(CONFIG.NAME, "签到失败", "未找到凭证，请先打开 ikuuu 网页抓取");
    return $done();
  }

  const headers = {
    "User-Agent": ua,
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Origin": "https://ikuuu.org",
    "Referer": "https://ikuuu.org/user",
  };
  if (cookie) headers["Cookie"] = cookie;
  if (auth) headers["Authorization"] = auth;

  console.log(`[${CONFIG.NAME}] 开始签到: ${CONFIG.CHECKIN_URL}`);

  $httpClient.post(
    {
      url: CONFIG.CHECKIN_URL,
      headers,
      body: "",
      timeout: CONFIG.TIMEOUT,
    },
    (err, resp, data) => {
      if (err) {
        console.log(`[${CONFIG.NAME}] 网络错误: ${err}`);
        $notification.post(CONFIG.NAME, "签到失败", `网络错误: ${err}`);
        return $done();
      }

      const code = resp ? resp.status : 0;
      const text = String(data || "");
      console.log(`[${CONFIG.NAME}] HTTP ${code}`);
      console.log(`[${CONFIG.NAME}] 响应: ${text.slice(0, 200)}`);

      if (code === 401 || code === 403) {
        $notification.post(CONFIG.NAME, "签到失败", `凭证失效(HTTP ${code})，请重新抓取`);
        return $done();
      }
      if (code !== 200) {
        $notification.post(CONFIG.NAME, "签到失败", `HTTP ${code}`);
        return $done();
      }

      let j = null;
      try {
        j = JSON.parse(text);
      } catch (_) {
        $notification.post(CONFIG.NAME, "签到异常", "返回非 JSON");
        return $done();
      }

      const msg = j.msg || j.message || (typeof j.data === "string" ? j.data : "") || "完成";
      const msgLower = msg.toLowerCase();

      // 已签到：不静默，照样通知
      if (/已签到|已经签到|already/.test(msgLower)) {
        $notification.post(CONFIG.NAME, "今日已签到", msg);
        return $done();
      }

      if (j.ret === 1 || j.success === true || /成功|success|获得/.test(msgLower)) {
        $persistentStore.write(new Date().toISOString(), KEY.LAST);
        $notification.post(CONFIG.NAME, "签到成功", msg);
        return $done();
      }

      $notification.post(CONFIG.NAME, "签到结果", msg);
      $done();
    }
  );
}

function lowerHeaders(h) {
  const o = {};
  Object.keys(h).forEach((k) => (o[k.toLowerCase()] = h[k]));
  return o;
}

/**
 * ===== Surge 配置示例 =====
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
