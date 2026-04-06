/**
 * ikuuu 自动签到（Surge）- 多接口回退版
 * 1) http-request 时抓 Cookie/Authorization
 * 2) cron 时依次尝试多个签到接口，成功后记住可用接口
 */

const CONFIG = {
  NAME: "ikuuu",
  DOMAIN: "ikuuu.org",
  TIMEOUT: 15,
  SILENT_ALREADY: false,

  // 候选签到接口（按优先顺序）
  CHECKIN_CANDIDATES: [
    "https://ikuuu.org/api/v1/user/checkin",
    "https://ikuuu.org/user/checkin",
    "https://ikuuu.org/api/user/checkin",
    "https://ikuuu.org/api/v2/user/checkin",
  ],

  // 用户信息接口候选（用于显示总量/剩余/到期）
  INFO_CANDIDATES: [
    "https://ikuuu.org/api/v1/user/getSubscribe",
    "https://ikuuu.org/api/v1/user/info",
    "https://ikuuu.org/user/getUserInfo",
  ],
};

const KEY = {
  COOKIE: "ikuuu_cookie",
  AUTH: "ikuuu_auth",
  UA: "ikuuu_ua",
  LAST: "ikuuu_last_checkin",
  LAST_GOOD_CHECKIN_URL: "ikuuu_last_good_checkin_url",
  LAST_GOOD_INFO_URL: "ikuuu_last_good_info_url",
};

(function () {
  if (typeof $request !== "undefined") {
    return capture();
  } else {
    return checkin();
  }
})();

function capture() {
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
    $persistentStore.write(ua, KEY.UA);

    if (saved.length) {
      console.log(`[${CONFIG.NAME}] 凭证已保存: ${saved.join("/")}`);
      $notification.post(CONFIG.NAME, "凭证获取成功", `已保存: ${saved.join(" / ")}`);
    }
  } catch (e) {
    console.log(`[${CONFIG.NAME}] capture error: ${e}`);
  }
  $done({});
}

function checkin() {
  const cookie = $persistentStore.read(KEY.COOKIE) || "";
  const auth = $persistentStore.read(KEY.AUTH) || "";
  const ua = $persistentStore.read(KEY.UA) || "Mozilla/5.0 Surge Script";

  if (!cookie && !auth) {
    $notification.post(CONFIG.NAME, "签到失败", "未找到凭证，请先访问 ikuuu 网站抓取");
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

  const lastGood = $persistentStore.read(KEY.LAST_GOOD_CHECKIN_URL);
  let urls = CONFIG.CHECKIN_CANDIDATES.slice();
  if (lastGood && urls.indexOf(lastGood) >= 0) {
    urls = [lastGood].concat(urls.filter((u) => u !== lastGood));
  }

  tryCheckinURLs(urls, headers, 0, (err, result) => {
    if (err) {
      $notification.post(CONFIG.NAME, "签到失败", err);
      return $done();
    }

    const msg = result.msg || "签到成功";
    const gain = result.gain || "已成功（未返回具体流量）";

    fetchInfoWithFallback(headers, (info) => {
      const body =
        `接口: ${result.url}\n` +
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

function tryCheckinURLs(urls, headers, idx, cb) {
  if (idx >= urls.length) return cb("所有候选签到接口都失败（可能站点改版）");

  const url = urls[idx];
  console.log(`[${CONFIG.NAME}] 尝试签到接口: ${url}`);

  const req = { url, headers, body: "{}", timeout: CONFIG.TIMEOUT };
  $httpClient.post(req, (err, resp, data) => {
    if (err) {
      console.log(`[${CONFIG.NAME}] ${url} 网络错误: ${err}`);
      return tryCheckinURLs(urls, headers, idx + 1, cb);
    }

    const status = resp ? resp.status : 0;
    console.log(`[${CONFIG.NAME}] ${url} status=${status} resp=${truncate(data, 200)}`);

    // 404/405 基本可判定接口不对，继续试
    if (status === 404 || status === 405) {
      return tryCheckinURLs(urls, headers, idx + 1, cb);
    }

    // 401/403 表示凭证问题，不再尝试路径
    if (status === 401 || status === 403) {
      return cb(`凭证失效（HTTP ${status}），请重新登录抓取 Cookie`);
    }

    // 其他非200也继续试
    if (status !== 200) {
      return tryCheckinURLs(urls, headers, idx + 1, cb);
    }

    const j = toJSON(data);
    if (!j) {
      // 有些接口返回纯文本成功
      if (/成功|success|已签到|already/i.test(String(data || ""))) {
        $persistentStore.write(url, KEY.LAST_GOOD_CHECKIN_URL);
        return cb(null, { url, msg: String(data), gain: parseGain(String(data)) });
      }
      return tryCheckinURLs(urls, headers, idx + 1, cb);
    }

    const msg = j.message || j.msg || (typeof j.data === "string" ? j.data : "") || "";

    // 已签到
    if (/已签到|已经签到|already/i.test(msg)) {
      if (!CONFIG.SILENT_ALREADY) $notification.post(CONFIG.NAME, "今日已签到", msg || "无需重复签到");
      return cb("今日已签到");
    }

    const success =
      j.ret === 1 || j.success === true || j.status === "success" || j.code === 200 || /成功|success|获得/i.test(msg);

    if (!success) return tryCheckinURLs(urls, headers, idx + 1, cb);

    // 成功，记住URL
    $persistentStore.write(url, KEY.LAST_GOOD_CHECKIN_URL);
    cb(null, { url, msg, gain: parseGain(msg) });
  });
}

function fetchInfoWithFallback(headers, cb) {
  const lastGood = $persistentStore.read(KEY.LAST_GOOD_INFO_URL);
  let urls = CONFIG.INFO_CANDIDATES.slice();
  if (lastGood && urls.indexOf(lastGood) >= 0) {
    urls = [lastGood].concat(urls.filter((u) => u !== lastGood));
  }

  function next(i) {
    if (i >= urls.length) {
      return cb({ total: "未知", used: "未知", left: "未知", expire: "未知" });
    }

    const url = urls[i];
    const req = { url, headers, timeout: CONFIG.TIMEOUT };
    $httpClient.get(req, (err, resp, data) => {
      if (err || !resp || resp.status !== 200) return next(i + 1);

      const j = toJSON(data);
      if (!j) return next(i + 1);

      const d = j.data || j.result || j;
      const totalB = Number(d.transfer_enable || d.total || 0);
      const usedB = Number(d.u || 0) + Number(d.d || 0) || Number(d.used || 0);
      const leftB = totalB > 0 ? totalB - usedB : Number(d.left || d.remain || 0);

      const info = {
        total: totalB > 0 ? fmtBytes(totalB) : "未知",
        used: usedB >= 0 ? fmtBytes(usedB) : "未知",
        left: leftB >= 0 ? fmtBytes(leftB) : "未知",
        expire: fmtExpire(d.expired_at || d.expire_at || d.class_expire || d.expire),
      };

      $persistentStore.write(url, KEY.LAST_GOOD_INFO_URL);
      cb(info);
    });
  }

  next(0);
}

// utils
function lowerHeaders(h) {
  const o = {};
  Object.keys(h).forEach((k) => (o[k.toLowerCase()] = h[k]));
  return o;
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
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
