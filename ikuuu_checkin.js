/**
 * ikuuu 自动签到（Surge）
 * 功能：
 * 1) http-request 触发时自动抓取 Cookie / Authorization 并持久化
 * 2) cron 触发时自动签到，并通知结果
 */

const CONFIG = {
  NAME: "ikuuu",
  DOMAIN: "ikuuu.org",
  CHECKIN_URL: "https://ikuuu.org/api/v1/user/checkin",
  SUBSCRIBE_URL: "https://ikuuu.org/api/v1/user/getSubscribe", // 用于获取总量/已用/剩余/到期
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
    return capture();
  } else {
    return checkin();
  }
})();

// ===== 抓取 Cookie / Authorization =====
function capture() {
  try {
    const url = $request.url || "";
    if (!url.includes(CONFIG.DOMAIN)) {
      console.log(`[${CONFIG.NAME}] 非目标域名，跳过: ${url}`);
      return $done({});
    }

    const headers = lowerHeaders($request.headers || {});
    const cookie = headers["cookie"] || "";
    const auth = headers["authorization"] || "";
    const ua = headers["user-agent"] || "Mozilla/5.0";

    let ok = false;
    let saved = [];

    if (cookie) {
      $persistentStore.write(cookie, KEY.COOKIE);
      ok = true;
      saved.push("Cookie");
      console.log(`[${CONFIG.NAME}] Cookie 已保存`);
    }

    if (auth) {
      $persistentStore.write(auth, KEY.AUTH);
      ok = true;
      saved.push("Authorization");
      console.log(`[${CONFIG.NAME}] Authorization 已保存`);
    }

    if (ua) $persistentStore.write(ua, KEY.UA);

    if (ok) {
      $notification.post(CONFIG.NAME, "凭证获取成功", `已保存: ${saved.join(" / ")}`);
    } else {
      console.log(`[${CONFIG.NAME}] 未抓到 Cookie/Authorization`);
    }
  } catch (e) {
    console.log(`[${CONFIG.NAME}] capture error: ${e}`);
  }
  $done({});
}

// ===== 定时签到 =====
function checkin() {
  const cookie = $persistentStore.read(KEY.COOKIE) || "";
  const auth = $persistentStore.read(KEY.AUTH) || "";
  const ua = $persistentStore.read(KEY.UA) || "Mozilla/5.0 Surge Script";

  if (!cookie && !auth) {
    $notification.post(CONFIG.NAME, "签到失败", "未找到凭证，请先访问 ikuuu 网页抓取 Cookie");
    return $done();
  }

  const headers = {
    "User-Agent": ua,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: "https://ikuuu.org",
    Referer: "https://ikuuu.org/",
  };
  if (cookie) headers["Cookie"] = cookie;
  if (auth) headers["Authorization"] = auth;

  const req = {
    url: CONFIG.CHECKIN_URL,
    headers,
    body: "{}",
    timeout: CONFIG.TIMEOUT,
  };

  console.log(`[${CONFIG.NAME}] 开始签到`);

  $httpClient.post(req, (err, resp, data) => {
    if (err) {
      $notification.post(CONFIG.NAME, "签到失败", `网络错误: ${err}`);
      return $done();
    }

    const status = resp ? resp.status : 0;
    console.log(`[${CONFIG.NAME}] checkin status=${status}`);
    console.log(`[${CONFIG.NAME}] checkin resp=${truncate(data, 300)}`);

    if (status !== 200) {
      if (status === 401 || status === 403) {
        $notification.post(CONFIG.NAME, "签到失败", `凭证失效(HTTP ${status})，请重新抓取`);
      } else {
        $notification.post(CONFIG.NAME, "签到失败", `HTTP ${status} ${truncate(data, 80)}`);
      }
      return $done();
    }

    const j = toJSON(data);
    if (!j) {
      $notification.post(CONFIG.NAME, "签到异常", "返回非 JSON");
      return $done();
    }

    const msg = j.message || j.msg || (typeof j.data === "string" ? j.data : "") || "";
    const msgLower = msg.toLowerCase();

    if (/已签到|已经签到|already/.test(msgLower)) {
      if (!CONFIG.SILENT_ALREADY) {
        $notification.post(CONFIG.NAME, "今日已签到", msg || "无需重复签到");
      }
      return $done();
    }

    const success =
      j.ret === 1 || j.success === true || j.status === "success" || /成功|success|获得/.test(msgLower);

    if (!success) {
      $notification.post(CONFIG.NAME, "签到失败", msg || "接口返回失败");
      return $done();
    }

    const gain = parseGain(msg) || "已成功（未返回具体流量）";

    // 再取订阅信息，补充总量/剩余/到期
    getSubscribe(headers, (info) => {
      const body =
        `签到流量: ${gain}\n` +
        `当前总流量: ${info.total}\n` +
        `已用流量: ${info.used}\n` +
        `剩余流量: ${info.left}\n` +
        `到期时间: ${info.expire}`;

      $persistentStore.write(new Date().toISOString(), KEY.LAST);
      $notification.post(CONFIG.NAME, "签到成功", body);
      $done();
    });
  });
}

function getSubscribe(headers, cb) {
  const req = {
    url: CONFIG.SUBSCRIBE_URL,
    headers,
    timeout: CONFIG.TIMEOUT,
  };

  $httpClient.get(req, (err, resp, data) => {
    if (err || !resp || resp.status !== 200) {
      console.log(`[${CONFIG.NAME}] getSubscribe 失败: ${err || (resp && resp.status)}`);
      return cb({ total: "未知", used: "未知", left: "未知", expire: "未知" });
    }

    const j = toJSON(data);
    if (!j || !j.data) {
      return cb({ total: "未知", used: "未知", left: "未知", expire: "未知" });
    }

    const d = j.data;
    const totalB = Number(d.transfer_enable || 0);
    const usedB = Number(d.u || 0) + Number(d.d || 0);
    const leftB = totalB - usedB;

    cb({
      total: totalB > 0 ? fmtBytes(totalB) : "未知",
      used: usedB >= 0 ? fmtBytes(usedB) : "未知",
      left: leftB >= 0 ? fmtBytes(leftB) : "未知",
      expire: fmtExpire(d.expired_at || d.expire_at || d.class_expire),
    });
  });
}

// ===== utils =====
function lowerHeaders(h) {
  const o = {};
  Object.keys(h).forEach((k) => (o[k.toLowerCase()] = h[k]));
  return o;
}
function toJSON(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}
function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "..." : s;
}
function parseGain(msg) {
  const m = String(msg || "").match(/([+\-]?\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|KiB|MiB|GiB|TiB)/i);
  return m ? `${m[1]} ${m[2].toUpperCase()}` : "";
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
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

/**
 * ===== Surge 配置示例 =====
 *
 * [Script]
 * ikuuu-Cookie-Capture = type=http-request,pattern=^https?:\/\/(ikuuu\.org)\/.*,requires-body=0,script-path=你的路径/ikuuu_checkin.js
 * ikuuu-Auto-Checkin = type=cron,cronexp=5 9 * * *,wake-system=1,timeout=30,script-path=你的路径/ikuuu_checkin.js
 *
 * [MITM]
 * hostname = ikuuu.org
 */
