/* pododa 화면 언어 — coverfo(cf-ui-lang.js)의 "화면 언어"와 같은 방식
   ① 자동(시간대 따름): 폰 시간대로 나라를 어림해 그 나라 말로 (준비 안 된 말이면 영어)
   ② 화면의 한국어 글자를 모아 번역해 바꿔 넣고, 한 번 번역한 문장은 이 기기(localStorage)에 적어 둔다 → 다음부터 즉시
   ③ 번역기: 구글(무료) → MyMemory(무료) 순. 키 필요 없음
   ④ 고른 말은 pd_lang 에도 넣어 글 등록·로그인 때 보내는 언어(lang_code)가 같이 바뀐다
   ⑤ data-cf-noui 가 붙은 칸(이용자가 쓴 글·닉네임·채팅)은 번역하지 않는다 */
(function () {
  if (window.pdUiLang) return;
  var LANGS = [
    ["auto", "🌐", "자동(시간대 따름)"],
    ["ko", "🇰🇷", "한국어"],
    ["en", "🇺🇸", "English"],
    ["zh", "🇨🇳", "中文"],
    ["hi", "🇮🇳", "हिन्दी"],
    ["es", "🇪🇸", "Español"],
    ["fr", "🇫🇷", "Français"],
    ["de", "🇩🇪", "Deutsch"]
  ];
  /* 시간대 도시 → [말, 나라 이름, 나라 코드]. 나라 코드는 cf-quick.js(빠른 실행: 지도·쇼핑·송금·숙소를 나라별 앱으로)가 쓴다 */
  var TZ = {
    Seoul: ["ko", "대한민국", "KR"], Pyongyang: ["ko", "조선", "KP"],
    Tokyo: ["ja", "일본", "JP"], Shanghai: ["zh", "중국", "CN"], Chongqing: ["zh", "중국", "CN"], Hong_Kong: ["zh", "홍콩", "HK"], Taipei: ["zh", "대만", "TW"], Macau: ["zh", "마카오", "MO"],
    Kolkata: ["hi", "인도", "IN"], Calcutta: ["hi", "인도", "IN"],
    Madrid: ["es", "스페인", "ES"], Mexico_City: ["es", "멕시코", "MX"], Bogota: ["es", "콜롬비아", "CO"], Buenos_Aires: ["es", "아르헨티나", "AR"], Santiago: ["es", "칠레", "CL"], Lima: ["es", "페루", "PE"],
    Paris: ["fr", "프랑스", "FR"], Brussels: ["fr", "벨기에", "BE"],
    Berlin: ["de", "독일", "DE"], Vienna: ["de", "오스트리아", "AT"], Zurich: ["de", "스위스", "CH"],
    New_York: ["en", "미국", "US"], Detroit: ["en", "미국", "US"], Chicago: ["en", "미국", "US"], Denver: ["en", "미국", "US"], Los_Angeles: ["en", "미국", "US"], Phoenix: ["en", "미국", "US"], Anchorage: ["en", "미국", "US"], Honolulu: ["en", "미국", "US"], Boise: ["en", "미국", "US"],
    Toronto: ["en", "캐나다", "CA"], Vancouver: ["en", "캐나다", "CA"], Edmonton: ["en", "캐나다", "CA"], Winnipeg: ["en", "캐나다", "CA"], Halifax: ["en", "캐나다", "CA"],
    London: ["en", "영국", "GB"], Dublin: ["en", "아일랜드", "IE"],
    Sydney: ["en", "호주", "AU"], Melbourne: ["en", "호주", "AU"], Brisbane: ["en", "호주", "AU"], Perth: ["en", "호주", "AU"], Adelaide: ["en", "호주", "AU"], Auckland: ["en", "뉴질랜드", "NZ"], Singapore: ["en", "싱가포르", "SG"], Manila: ["en", "필리핀", "PH"],
    Bangkok: ["th", "태국", "TH"], Ho_Chi_Minh: ["vi", "베트남", "VN"], Jakarta: ["id", "인도네시아", "ID"],
    Rome: ["it", "이탈리아", "IT"], Amsterdam: ["nl", "네덜란드", "NL"], Lisbon: ["pt", "포르투갈", "PT"], Sao_Paulo: ["pt", "브라질", "BR"], Dubai: ["ar", "아랍에미리트", "AE"],
    Riyadh: ["ar", "사우디아라비아", "SA"], Istanbul: ["tr", "튀르키예", "TR"], Warsaw: ["pl", "폴란드", "PL"], Stockholm: ["sv", "스웨덴", "SE"], Oslo: ["no", "노르웨이", "NO"], Copenhagen: ["da", "덴마크", "DK"], Helsinki: ["fi", "핀란드", "FI"],
    Athens: ["el", "그리스", "GR"], Budapest: ["hu", "헝가리", "HU"], Bratislava: ["sk", "슬로바키아", "SK"], Sofia: ["bg", "불가리아", "BG"], Zagreb: ["hr", "크로아티아", "HR"], Belgrade: ["sr", "세르비아", "RS"],
    Ljubljana: ["sl", "슬로베니아", "SI"], Sarajevo: ["bs", "보스니아 헤르체고비나", "BA"], Tirane: ["sq", "알바니아", "AL"], Skopje: ["mk", "북마케도니아", "MK"], Chisinau: ["ro", "몰도바", "MD"], Minsk: ["ru", "벨라루스", "BY"],
    Kuala_Lumpur: ["ms", "말레이시아", "MY"], Johannesburg: ["en", "남아프리카", "ZA"], Cairo: ["ar", "이집트", "EG"], Karachi: ["ur", "파키스탄", "PK"], Dhaka: ["bn", "방글라데시", "BD"]
  };
  function LS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function LSS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function tzGuess() {
    try { var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; var city = tz.split("/").pop(); if (TZ[city]) return TZ[city]; } catch (e) {}
    try { var nl = (navigator.language || "").slice(0, 2).toLowerCase(); for (var i = 1; i < LANGS.length; i++) if (LANGS[i][0] === nl) return [nl, ""]; } catch (e2) {}
    return ["ko", "대한민국"];
  }
  function pick() { return LS("pd_ui") || "auto"; }
  function lang() {
    var p = pick(); if (p !== "auto") return p;
    var g = tzGuess()[0];
    for (var i = 1; i < LANGS.length; i++) if (LANGS[i][0] === g) return g;
    return "en";
  }
  function where() { var g = tzGuess(); return g[1] || ""; }
  /* 나라 코드 (US·KR…): 시간대로 어림. 못 맞추면 "" (cf-quick.js 가 KR 로 본다) */
  function country() { var g = tzGuess(); return g[2] || ""; }
  function countryName(code) { for (var k in TZ) if (TZ[k][2] === code) return TZ[k][1]; return code; }
  function cache(l) { try { return JSON.parse(LS("pd_uic_" + l) || "{}"); } catch (e) { return {}; } }
  function cacheSave(l, o) { LSS("pd_uic_" + l, JSON.stringify(o)); }

  /* ── 번역기 (무료) ── */
  function trGoogle(text, to, ok, fail) {
    try {
      var u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=" + encodeURIComponent(to) + "&dt=t&q=" + encodeURIComponent(text);
      var t = setTimeout(function () { t = null; fail(); }, 8000);
      fetch(u).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
        if (t === null) return; clearTimeout(t);
        var seg = d && d[0]; if (!seg || !seg.length) { fail(); return; }
        var out = ""; for (var i = 0; i < seg.length; i++) out += (seg[i][0] || "");
        out = out.trim(); if (!out) { fail(); return; } ok(out);
      })["catch"](function () { if (t === null) return; clearTimeout(t); fail(); });
    } catch (e) { fail(); }
  }
  function trMyMemory(text, to, ok, fail) {
    try {
      var u = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=" + encodeURIComponent("ko|" + to);
      var t = setTimeout(function () { t = null; fail(); }, 8000);
      fetch(u).then(function (r) { return r.json(); }).then(function (d) {
        if (t === null) return; clearTimeout(t);
        var x = d && d.responseData && d.responseData.translatedText;
        if (x && !/MYMEMORY WARNING|INVALID|NO QUERY/i.test(x)) ok(String(x).trim()); else fail();
      })["catch"](function () { if (t === null) return; clearTimeout(t); fail(); });
    } catch (e) { fail(); }
  }
  function translateOne(text, to, done) { trGoogle(text, to, done, function () { trMyMemory(text, to, done, function () { done(""); }); }); }
  /* 한 문장 번역(밖에서도 씀 — cf-quick.js 가 한국 밖에서 지도·쇼핑 검색어를 영어로 바꿀 때). 실패하면 "" */
  function translate(text, to, done) { var key = "pd_tr_" + to + "|" + text; var hit = LS(key); if (hit) { done(hit); return; } translateOne(String(text || ""), to || "en", function (out) { if (out) LSS(key, out); done(out || ""); }); }

  var Q = [], busy = false, seen = {}, paintT = null;
  function step() {
    var job = Q.shift(); if (!job) { busy = false; return; }
    busy = true;
    translateOne(job.t, job.l, function (out) {
      if (out) { var c = cache(job.l); c[job.t] = out; cacheSave(job.l, c); if (paintT) clearTimeout(paintT); paintT = setTimeout(paintNow, 220); }
      setTimeout(step, 80);
    });
  }
  var KO = /[가-힣]/;
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
  function skipEl(pn) {
    if (!pn) return true;
    if (SKIP[pn.nodeName]) return true;
    try {
      if (pn.closest && pn.closest("[data-cf-noui], .cm-editor, .cm-content, [contenteditable=true], pre, code")) return true;
    } catch (e) {}
    return false;
  }
  function paintNow() {
    var l = lang(); if (l === "ko") return;
    var c = cache(l), miss = [];
    var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      if (!n.nodeValue || !KO.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      if (skipEl(n.parentNode)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    } });
    var n, list = []; while ((n = walk.nextNode())) list.push(n);
    list.forEach(function (node) {
      var raw = node.__ko || node.nodeValue, key = raw.trim(); if (!key) return;
      node.__ko = raw;
      if (c[key]) { node.nodeValue = raw.replace(key, c[key]); return; }
      if (!seen[l + "|" + key]) { seen[l + "|" + key] = 1; miss.push(key); }
    });
    [].forEach.call(document.querySelectorAll("input[placeholder],textarea[placeholder],[title]"), function (el) {
      var isTitle = !el.hasAttribute("placeholder");
      var raw = el.__ko || el.getAttribute(isTitle ? "title" : "placeholder") || "";
      if (!KO.test(raw)) return;
      el.__ko = raw;
      if (c[raw]) { el.setAttribute(isTitle ? "title" : "placeholder", c[raw]); return; }
      if (!seen[l + "|" + raw]) { seen[l + "|" + raw] = 1; miss.push(raw); }
    });
    miss.slice(0, 80).forEach(function (t) { Q.push({ t: t, l: l }); });
    if (miss.length && !busy) step();
  }
  var obs = null, obsT = null;
  function watch() {
    if (lang() === "ko") return;
    if (obs) return;
    try {
      obs = new MutationObserver(function () { if (obsT) clearTimeout(obsT); obsT = setTimeout(paintNow, 160); });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) {}
    paintNow();
  }
  function set(v) {
    LSS("pd_ui", v);
    try { if (typeof currentLang !== "undefined") currentLang = lang(); } catch (e) {}
    /* 답변 언어도 같이 — 채팅 답변·렌즈 분석·음성 인식이 같은 말을 쓴다 */
    LSS("pd_lang", lang());
    seen = {};
    if (obs) { try { obs.disconnect(); } catch (e) {} obs = null; }
    if (lang() === "ko") { location.reload(); return; }   /* 한국어로 되돌릴 때는 새로 고쳐 원문을 되살린다 */
    watch();
  }
  /* 관리자가 빠른 실행 나라를 시험용으로 바꿔 두었으면 표시 (cf-quick.js 의 localStorage cf_country) */
  function overrideNote() { return ""; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  /* 설정 칸에 넣는 칩 HTML (홈 사이드바·채팅 사이드바 공용). data-cf-noui: 이 칸 글자는 번역하지 않는다 */
  function chipsHtml() {
    var p = pick();
    return '<div class="cf-ui-lang" data-cf-noui="1">' +
      LANGS.map(function (x) { return '<button type="button" class="cf-ui-chip' + (p === x[0] ? " on" : "") + '" data-cf-ui="' + x[0] + '">' + x[1] + " " + x[2] + "</button>"; }).join("") +
      "</div>" + (where() ? '<div class="cf-ui-where" data-cf-noui="1">🕐 시간대 기준 · <b>' + esc(where()) + "</b>" + overrideNote() + "</div>" : "");
  }
  function mount(el) {
    if (!el) return;
    el.innerHTML = chipsHtml();
    el.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-cf-ui]") : null; if (!b) return;
      e.preventDefault(); e.stopPropagation();
      set(b.getAttribute("data-cf-ui"));
      el.innerHTML = chipsHtml();
    });
  }
  if (!document.getElementById("pd-ui-lang-css")) {
    var st = document.createElement("style"); st.id = "pd-ui-lang-css";
    st.textContent = ".cf-ui-lang{display:flex;flex-wrap:wrap;gap:6px;padding:4px 0 2px}" +
      ".cf-ui-chip{border:1.5px solid transparent;background:#f1edfb;color:#222;border-radius:999px;padding:7px 11px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}" +
      ".cf-ui-chip.on{background:#fff;border-color:#6d28d9;color:#5b21b6}" +
      ".cf-ui-where{font-size:11.5px;color:#777;margin-top:6px}" +
      "html[data-theme=dark] .cf-ui-chip{background:#2a2540;color:#eee}html[data-theme=dark] .cf-ui-chip.on{background:#1b1533;border-color:#a78bfa;color:#e9d5ff}html[data-theme=dark] .cf-ui-where{color:#aaa}";
    (document.head || document.documentElement).appendChild(st);
  }
  window.pdUiLang = { LANGS: LANGS, pick: pick, lang: lang, where: where, country: country, countryName: countryName, translate: translate, set: set, chipsHtml: chipsHtml, mount: mount, paint: paintNow, watch: watch };
  if (document.body) watch(); else document.addEventListener("DOMContentLoaded", watch);
})();
