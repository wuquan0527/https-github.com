```javascript
/**
 * ikuuu 自动签到（详细通知版）
 * - 单独提取“今日签到获得流量”
 * - 通知显示：签到状态、今日获得、总流量、已用、剩余、到期时间、接口
 */

const CONFIG = {
  NAME: "ikuuu",
  DOMAIN: "ikuuu.org",
  CHECKIN_URL: "https://ikuuu.org/user/checkin?ajax=1",
  INFO_URL: "https://ikuuu.org/api/v1/user/getSubscribe",
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
    if (cookie) { $persistentStore.write(cookie, KEY.COOKIE); saved.push("Cookie"); }
    if (auth) { $persistentStore.write(auth, KEY.AUTH); saved.push("Authorization"); }
    if (ua) $persistentStore.write(ua, KEY.UA);

    if (saved.length) {
      $notification.post(CONFIG.NAME, "凭证获取成功", `已保存: ${saved.join(" / ")}`);
    }
  } catch (_) {}
  $done({});
}

// ===== 签到 =====
function doCheckin() {
  const cookie = $persistentStore.read(KEY.COOKIE) || "";
  const auth = $persistentStore.read(KEY.AUTH) || "";
  const ua = $persistentStore.read(KEY.UA) || "Mozilla/5.0 Surge Script";

  if (!cookie && !auth) {
    $notification.post(CONFIG.NAME, "签到失败", "未找到凭证，请先访问 ikuuu 网站抓取");
    return $done();
  }

  const headers = buildHeaders(cookie, auth, ua);
  console.log(`[${CONFIG.NAME}] 开始签到: ${CONFIG.CHECKIN_URL}`);

  $httpClient.post(
    { url: CONFIG.CHECKIN_URL, headers, body: "", timeout: CONFIG.TIMEOUT },
    (err, resp, data) => {
      if (err) {
        $notification.post(CONFIG.NAME, "签到失败", `网络错误: ${err}`);
        return $done();
      }

      const code = resp ? resp.status : 0;
      const raw = String(data || "");
      console.log(`[${CONFIG.NAME}] checkin status=${code}`);
      console.log(`[${CONFIG.NAME}] checkin resp=${raw.slice(0, 200)}`);

      if (code !== 200) {
        $notification.post(CONFIG.NAME, "签到失败", `HTTP ${code}`);
        return $done();
      }

      let j = null;
      try { j = JSON.parse(raw); } catch (_) {}
      const msg = j ? (j.msg || j.message || (typeof j.data === "string" ? j.data : "")) : raw;
      const gain = extractGain(msg, raw); // ✅ 今日签到获得流量

      const already = /已签到|已经签到|already/i.test((msg || "").toLowerCase());
      const success = j && (j.ret === 1 || j.success === true || /成功|success|获得/i.test((msg || "").toLowerCase()));

      fetchTraffic(headers, (t) => {
        const title = already ? "今日已签到" : (success ? "签到成功" : "签到结果");
        if (success) $persistentStore.write(new Date().toISOString(), KEY.LAST);

        const body =
          `状态消息: ${msg || "无"}\n` +
          `今日获得流量: ${gain || "未识别"}\n` +
          `总流量: ${t.total}\n` +
          `已用流量: ${t.used}\n` +
          `剩余流量: ${t.left}\n` +
          `到期时间: ${t.expire}\n` +
          `签到接口: ${CONFIG.CHECKIN_URL}`;

        $notification.post(CONFIG.NAME, title, body);
        $done();
      });
    }
  );
}

// ===== 获取流量信息 =====
function fetchTraffic(headers, cb) {
  $httpClient.get({ url: CONFIG.INFO_URL, headers, timeout: CONFIG.TIMEOUT }, (err, resp, data) => {
    if (err || !resp || resp.status !== 200) {
      return cb({ total: "未知", used: "未知", left: "未知", expire: "未知" });
    }

    let j = null;
    try { j = JSON.parse(String(data || "")); } catch (_) {}
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
      expire: fmtExpire(d.exp