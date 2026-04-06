const URL = "https://ikuuu.org/user/checkin";
const K = { c: "ikuuu_cookie", a: "ikuuu_auth", u: "ikuuu_ua" };

(function () {
  const isReq = typeof $request !== "undefined";

  if (isReq) {
    const h = lower($request.headers || {});
    const c = h.cookie || "";
    const a = h.authorization || "";
    const ua = h["user-agent"] || "Mozilla/5.0";

    if (c) $persistentStore.write(c, K.c);
    if (a) $persistentStore.write(a, K.a);
    $persistentStore.write(ua, K.u);

    if (c || a) $notification.post("ikuuu", "抓取成功", c ? "Cookie 已保存" : "Authorization 已保存");
    return $done({});
  }

  // cron / panel 按钮模式
  $notification.post("ikuuu", "签到脚本已启动", "进入请求阶段");
  const c = $persistentStore.read(K.c) || "";
  const a = $persistentStore.read(K.a) || "";
  const ua = $persistentStore.read(K.u) || "Mozilla/5.0 Surge Script";

  if (!c && !a) {
    $notification.post("ikuuu", "失败", "没有凭证，请先打开 ikuuu 网页抓取");
    return $done();
  }

  const headers = {
    "User-Agent": ua,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "https://ikuuu.org",
    "Referer": "https://ikuuu.org/user",
    "Accept": "*/*"
  };
  if (c) headers["Cookie"] = c;
  if (a) headers["Authorization"] = a;

  $httpClient.post({ url: URL, headers, body: "", timeout: 20 }, (e, r, d) => {
    if (e) {
      $notification.post("ikuuu", "网络错误", String(e));
      return $done();
    }
    const code = r ? r.status : 0;
    const body = String(d || "");
    $notification.post("ikuuu", `HTTP ${code}`, body.slice(0, 120));
    $done();
  });
})();

function lower(h){ const o={}; Object.keys(h).forEach(k=>o[k.toLowerCase()]=h[k]); return o; }
