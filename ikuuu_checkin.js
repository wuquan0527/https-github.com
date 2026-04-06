const CONFIG = {
  NAME: "ikuuu",
  DOMAIN: "ikuuu.org",
  CHECKIN_URL: "https://ikuuu.org/user/checkin?ajax=1",
  INFO_URL: "https://ikuuu.org/api/v1/user/getSubscribe",
  TIMEOUT: 20
};

const KEY = {
  COOKIE: "ikuuu_cookie",
  AUTH: "ikuuu_auth",
  UA: "ikuuu_ua",
  LAST: "ikuuu_last_checkin_time"
};

(function () {
  if (typeof $request !== "undefined") {
    captureCredential();
  } else {
    doCheckin();
  }
})();

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
    if (ua) {
      $persistentStore.write(ua, KEY.UA);
    }

    if (saved.length > 0) {
      $notification.post(CONFIG.NAME, "凭证获取成功", "已保存: " + saved.join(" / "));
    }
  } catch (e) {
    console.log("capture error: " + e);
  }
  $done({});
}

function doCheckin() {
  const cookie = $persistentStore.read(KEY.COOKIE) || "";
  const auth = $persistentStore.read(KEY.AUTH) || "";
  const ua = $persistentStore.read(KEY.UA) || "Mozilla/5.0 Surge Script";

  if (!cookie && !auth) {
    $notification.post(CONFIG.NAME, "签到失败", "未找到凭证，请先访问 ikuuu 网页抓取");
    return $done();
  }

  const headers = buildHeaders(cookie, auth, ua);
  console.log("[" + CONFIG.NAME + "] 开始签到: " + CONFIG.CHECKIN_URL);

  $httpClient.post({
    url: CONFIG.CHECKIN_URL,
    headers: headers,
    body: "",
    timeout: CONFIG.TIMEOUT
  }, function (err, resp, data) {
    if (err) {
      $notification.post(CONFIG.NAME, "签到失败", "网络错误: " + err);
      return $done();
    }

    const code = resp ? resp.status : 0;
    const text = String(data || "");
    console.log("[" + CONFIG.NAME + "] checkin status=" + code);
    console.log("[" + CONFIG.NAME + "] checkin resp=" + text.slice(0, 200));

    if (code !== 200) {
      $notification.post(CONFIG.NAME, "签到失败", "HTTP " + code);
      return $done();
    }

    let j = null;
    try {
      j = JSON.parse(text);
    } catch (_) {}

    const msg = j ? (j.msg || j.message || "") : text;
    const gain = extractGain(msg) || "未返回具体数值";

    fetchAccountInfo(headers, function (info) {
      const detail =
        "━━━━━━━━━━\n" +
        "签到消息：" + (msg || "无") + "\n" +
        "今日获得：" + gain + "\n" +
        "剩余流量：" + info.left + "\n" +
        "总流量：" + info.total + "\n" +
        "已用流量：" + info.used + "\n" +
        "到期时间：" + info.expire;

      const lower = String(msg || "").toLowerCase();

      if (/已签到|已经签到|already/.test(lower)) {
        $notification.post(CONFIG.NAME, "今日已签到", detail);
        return $done();
      }

      if (j && (j.ret === 1 || j.success === true || /成功|success|获得/.test(lower))) {
        $persistentStore.write(new Date().toISOString(), KEY.LAST);
        $notification.post(CONFIG.NAME, "签到成功", detail);
        return $done();
      }

      $notification.post(CONFIG.NAME, "签到结果", detail);
      $done();
    });
  });
}

function fetchAccountInfo(headers, cb) {
  $httpClient.get({
    url: CONFIG.INFO_URL,
    headers: headers,
    timeout: CONFIG.TIMEOUT
  }, function (err, resp, data) {
    if (err || !resp || resp.status !== 200) {
      return cb({
        total: "未知",
        used: "未知",
        left: "未知",
        expire: "未知"
      });
    }

    let j = null;
    try {
      j = JSON.parse(String(data || ""));
    } catch (_) {}

    if (!j || !j.data) {
      return cb({
        total: "未知",
        used: "未知",
        left: "未知",
        expire: "未知"
      });
    }

    const d = j.data;
    const totalB = Number(d.transfer_enable || 0);
    const usedB = Number(d.u || 0) + Number(d.d || 0);
    const leftB = totalB - usedB;

    cb({
      total: totalB > 0 ? fmtBytes(totalB) : "未知",
      used: usedB >= 0 ? fmtBytes(usedB) : "未知",
      left: leftB >= 0 ? fmtBytes(leftB) : "未知",
      expire: fmtExpire(d.expired_at || d.expire_at || d.class_expire || d.expire)
    });
  });
}

function buildHeaders(cookie, auth, ua) {
  const h = {
    "User-Agent": ua,
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Origin": "https://ikuuu.org",
    "Referer": "https://ikuuu.org/user"
  };
  if (cookie) h["Cookie"] = cookie;
  if (auth) h["Authorization"] = auth;
  return h;
}

function lowerHeaders(h) {
  const o = {};
  Object.keys(h).forEach(function (k) {
    o[k.toLowerCase()] = h[k];
  });
  return o;
}

function extractGain(msg) {
  const text = String(msg || "");
  const m = text.match(/([+\-]?\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|KiB|MiB|GiB|TiB)/i);
  return m ? (m[1] + " " + m[2].toUpperCase()) : "";
}

function fmtBytes(b) {
  if (!isFinite(b) || b < 0) return "未知";
  if (b === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + " " + u[i];
}

function fmtExpire(v) {
  if (!v) return "未知";
  if (typeof v === "number") {
    const t = v > 1e12 ? v : v * 1000;
    return formatDate(new Date(t));
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : formatDate(d);
}

function formatDate(d) {
  function p(n) { return n < 10 ? "0" + n : "" + n; }
  return d.getFullYear() + "-" +
    p(d.getMonth() + 1) + "-" +
    p(d.getDate()) + " " +
    p(d.getHours()) + ":" +
    p(d.getMinutes()) + ":" +
    p(d.getSeconds());
}

/**
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
