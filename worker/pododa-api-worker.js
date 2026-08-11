/* ══════════════════════════════════════════════════════════════════════
   포도다 API · Cloudflare Worker  (D1 전용 · 무료 플랜)

   푸는 문제
     1) 기기마다 데이터가 따로 논다        → 서버에 저장하고 동기화
     2) 동시 주문 시 재고 초과 판매        → SQL 조건부 UPDATE로 원자적 차감
     3) 앱을 닫으면 새 주문을 모른다       → VAPID 웹푸시 (본문 암호화 포함)

   필요한 바인딩 (대시보드에서 설정)
     D1 데이터베이스 :  변수 이름 DB      → pododa-db
     환경 변수       :  ALLOW_ORIGIN     = https://pododa.kr
                       INVITE_REQUIRED  = (안 넣으면 자유 등록. "1" 이면 초대제)
                       VAPID_PUBLIC     = (발급받은 공개키)
                       VAPID_SUBJECT    = mailto:hasin5jk@gmail.com
     시크릿(암호화)  :  VAPID_PRIVATE    = (발급받은 개인키)
                       TOKEN_SECRET     = (아무 긴 무작위 문자열)

   엔드포인트
     GET  /health
     POST /owner/register  {slug, pin}          → {token, recovery}   [자유 등록]
     GET  /stores          [?q=&cat=&limit=]     → 공유 가게 목록 (본문·사진 제외)
     POST /store/reindex   {adminKey}            → 목록 다시 만들기
     POST /owner/login     {slug, pin}          → {token}
     GET  /stock?slug=
     POST /stock/set       {slug, itemId, stock}          [사장님]
     POST /orders          {no, slug, items, total, ...}  → 재고 원자 차감 후 생성
     GET  /orders?slug=                                    [사장님]
     POST /orders/status   {slug, no, to, by}
     POST /push/subscribe  {slug, sub}                     [사장님]
     POST /push/unsubscribe {endpoint}
   ══════════════════════════════════════════════════════════════════════ */

const enc = new TextEncoder();

/* ── 응답 / CORS ─────────────────────────────────────────────── */
function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
const json = (d, env, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(env) },
  });
const bad = (m, env, s = 400) => json({ ok: false, error: m }, env, s);

/* ── 인코딩 유틸 ─────────────────────────────────────────────── */
function b64uToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bytesToB64u(b) {
  const a = new Uint8Array(b);
  let s = "";
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

function timingSafeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ── 인증 ────────────────────────────────────────────────────── */
async function pinHash(pin, salt) {
  /* 반복 10만회 — Cloudflare Workers 상한 */
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
  /* Workers는 PBKDF2 반복을 10만회까지만 허용합니다. 그 이상은 런타임 오류가 납니다. */
  return bytesToB64u(bits);
}
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToB64u(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
async function issueToken(env, slug) {
  const body = bytesToB64u(enc.encode(JSON.stringify({ slug, exp: Date.now() + 12 * 3600e3 })));
  return body + "." + (await hmac(env.TOKEN_SECRET, body));
}
async function verifyToken(env, token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!timingSafeEq(sig, await hmac(env.TOKEN_SECRET, body))) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64uToBytes(body)));
    return !p.exp || Date.now() > p.exp ? null : p;
  } catch { return null; }
}
async function requireOwner(req, env, slug) {
  const p = await verifyToken(env, (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
  if (!p) return { ok: false, msg: "인증이 필요합니다" };
  if (slug && p.slug !== slug) return { ok: false, msg: "다른 가게의 권한입니다" };
  return { ok: true, slug: p.slug };
}

/* ── 입점(자유 등록) · 가게 목록 ──────────────────────────────
   초대코드를 없애면 slug 를 아무렇게나 선점당할 수 있으므로,
   모양 검사와 예약어만 막아 둡니다. */
const RESERVED = ["admin","api","www","app","store","stores","shop","order","orders",
                  "push","owner","invite","health","stock","bridge","null","undefined"];
function slugOk(slug) {
  const s = String(slug || "");
  if (!/^[a-z0-9][a-z0-9_-]{2,39}$/.test(s)) return false;
  return RESERVED.indexOf(s) < 0;
}

/* 목록용 요약을 갱신합니다. 가게를 저장할 때마다 같이 불러줍니다. */
async function metaUpsert(env, slug, st) {
  const s = st || {};
  await env.DB.prepare(
    `INSERT INTO store_meta(slug,name,emoji,cat,area,paused,menus,updated)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(slug) DO UPDATE SET
       name=excluded.name, emoji=excluded.emoji, cat=excluded.cat, area=excluded.area,
       paused=excluded.paused, menus=excluded.menus, updated=excluded.updated`
  ).bind(
    slug,
    String(s.name || slug).slice(0, 120),
    String(s.emoji || "🏪").slice(0, 8),
    String(s.cat || "기타").slice(0, 40),
    String(s.area || "").slice(0, 120),
    s.paused ? 1 : 0,
    Array.isArray(s.menus) ? s.menus.length : 0,
    Date.now()
  ).run();
}

/* 패치 전에 등록된 가게들을 목록에 한 번만 채워 넣습니다.
   본문 전체를 JSON.parse 하지 않고 앞부분 문자열만 훑습니다
   (가게 JSON은 name·emoji·cat·area 가 menus 앞에 옵니다). */
function pick(head, key) {
  const m = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(head);
  if (!m) return "";
  try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1]; }
}
async function metaBackfill(env) {
  const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM store_meta`).first();
  if (c && c.n > 0) return 0;
  const rows = await env.DB.prepare(
    `SELECT slug, substr(body,1,3000) AS head, updated FROM stores LIMIT 200`
  ).all();
  const list = rows.results || [];
  for (const r of list) {
    await env.DB.prepare(
      `INSERT INTO store_meta(slug,name,emoji,cat,area,paused,menus,updated)
       VALUES(?,?,?,?,?,0,0,?) ON CONFLICT(slug) DO NOTHING`
    ).bind(r.slug, pick(r.head, "name") || r.slug, pick(r.head, "emoji") || "🏪",
           pick(r.head, "cat") || "기타", pick(r.head, "area"), r.updated || Date.now()).run();
  }
  return list.length;
}

/* ── 스키마 ──────────────────────────────────────────────────── */
async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS owners(
      slug TEXT PRIMARY KEY, salt TEXT, hash TEXT, rec_hash TEXT,
      fails INTEGER DEFAULT 0, lock_until INTEGER DEFAULT 0, ts INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS stock(
      slug TEXT, item TEXT, qty INTEGER, PRIMARY KEY(slug,item))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS orders(
      slug TEXT, no TEXT, status TEXT, total INTEGER, ts INTEGER,
      body TEXT, PRIMARY KEY(slug,no))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS subs(
      endpoint TEXT PRIMARY KEY, slug TEXT, p256dh TEXT, auth TEXT, ts INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS invites(
      code TEXT PRIMARY KEY, slug TEXT, used INTEGER DEFAULT 0, ts INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS stores(
      slug TEXT PRIMARY KEY, body TEXT, updated INTEGER)`),
    /* 가게 "목록" 전용 가벼운 표.
       stores.body 에는 사진(base64)이 들어 있어 200개를 한꺼번에 파싱하면
       워커 메모리가 터집니다. 목록에 필요한 값만 따로 떼어 둡니다. */
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS store_meta(
      slug TEXT PRIMARY KEY, name TEXT, emoji TEXT, cat TEXT, area TEXT,
      paused INTEGER DEFAULT 0, menus INTEGER DEFAULT 0, updated INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate(
      k TEXT PRIMARY KEY, n INTEGER, win INTEGER)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_orders ON orders(slug, ts DESC)`),
  ]);
}

/* ── 남용 방어 ────────────────────────────────────────────────
   /orders 는 손님이 부르는 무인증 경로입니다. 공개 URL 서비스라
   누구나 스크립트로 두드릴 수 있으므로, 여기서 막지 않으면
   푸시 폭격 · 재고 소진 · D1 무료 한도 소진이 한꺼번에 일어납니다. */
const LIMITS = {
  ITEMS: 30,          /* 한 주문의 품목 종류 */
  QTY: 99,            /* 품목당 수량 */
  TOTAL_QTY: 200,     /* 주문 전체 수량 */
  AMOUNT: 20000000,   /* 결제금액 상한 (2천만원) */
  NAME: 120,          /* 이름 길이 */
  BODY: 60000,        /* 주문 JSON 크기 */
  PER_MIN_STORE: 30,  /* 가게당 분당 주문 */
  PER_MIN_IP: 10,     /* IP당 분당 주문 */
};

function checkOrder(body) {
  const items = body.items || [];
  if (!Array.isArray(items) || items.length === 0) return "주문 품목이 없습니다";
  if (items.length > LIMITS.ITEMS) return `품목이 너무 많습니다 (최대 ${LIMITS.ITEMS}종)`;
  if (JSON.stringify(body).length > LIMITS.BODY) return "주문 내용이 너무 큽니다";

  let totalQty = 0;
  for (const it of items) {
    const q = Number(it.qty);
    if (!Number.isFinite(q) || q < 1 || q > LIMITS.QTY) return `수량이 올바르지 않습니다 (1~${LIMITS.QTY})`;
    if (typeof it.name === "string" && it.name.length > LIMITS.NAME) return "품목 이름이 너무 깁니다";
    totalQty += q;
  }
  if (totalQty > LIMITS.TOTAL_QTY) return `한 번에 주문할 수 있는 수량을 넘었습니다 (최대 ${LIMITS.TOTAL_QTY}개)`;

  const total = Number(body.total);
  if (!Number.isFinite(total) || total < 0 || total > LIMITS.AMOUNT) return "결제금액이 올바르지 않습니다";
  if (typeof body.no !== "string" || body.no.length > 64) return "주문번호가 올바르지 않습니다";
  return null;
}

/* 1분 고정 창 카운터. 창이 바뀌면 0부터 다시 셉니다. */
async function hitLimit(env, key, max) {
  const win = Math.floor(Date.now() / 60000);
  const row = await env.DB.prepare(`SELECT n, win FROM rate WHERE k=?`).bind(key).first();
  if (!row || row.win !== win) {
    await env.DB.prepare(
      `INSERT INTO rate(k,n,win) VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET n=1, win=excluded.win`
    ).bind(key, win).run();
    return false;
  }
  if (row.n >= max) return true;
  await env.DB.prepare(`UPDATE rate SET n=n+1 WHERE k=?`).bind(key).run();
  return false;
}
function clientIp(req) {
  return req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "unknown";
}

/* ── 재고: 조건부 UPDATE 로 원자적 차감 ───────────────────────
   qty >= ? 조건을 SQL 안에 두어, 검사와 차감 사이에 끼어들 틈이 없습니다.
   변경된 행이 0이면 재고 부족이므로 이미 성공한 항목을 되돌립니다. */
function needMap(items) {
  const need = {};
  (items || []).forEach((it) => {
    const id = it.mid || it.pid || it.name;
    if (id) need[id] = (need[id] || 0) + (it.qty || 1);
  });
  return need;
}
async function takeStock(env, slug, need) {
  const ids = Object.keys(need);
  if (!ids.length) return { ok: true };

  const rows = await env.DB.prepare(
    `SELECT item, qty FROM stock WHERE slug=? AND item IN (${ids.map(() => "?").join(",")})`
  ).bind(slug, ...ids).all();
  const managed = new Map((rows.results || []).map((r) => [r.item, r.qty]));

  const taken = [];
  for (const id of ids) {
    if (!managed.has(id)) continue;                    /* 재고 미관리 품목은 통과 */
    const r = await env.DB.prepare(
      `UPDATE stock SET qty = qty - ? WHERE slug=? AND item=? AND qty >= ?`
    ).bind(need[id], slug, id, need[id]).run();
    if (r.meta.changes === 1) { taken.push(id); continue; }

    for (const t of taken) {                            /* 실패 → 되돌리기 */
      await env.DB.prepare(`UPDATE stock SET qty = qty + ? WHERE slug=? AND item=?`)
        .bind(need[t], slug, t).run();
    }
    return { ok: false, short: { itemId: id, left: managed.get(id), want: need[id] } };
  }
  return { ok: true };
}
async function giveStock(env, slug, need) {
  for (const id of Object.keys(need)) {
    await env.DB.prepare(`UPDATE stock SET qty = qty + ? WHERE slug=? AND item=?`)
      .bind(need[id], slug, id).run();
  }
}

/* ── 웹푸시 (RFC 8291 aes128gcm + VAPID) ─────────────────────── */
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
async function encryptPayload(text, p256dh, auth) {
  const uaPub = b64uToBytes(p256dh);
  const authSecret = b64uToBytes(auth);
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const peer = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, keys.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const pt = concat(enc.encode(text), new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, pt));

  return concat(salt, u32(4096), new Uint8Array([asPub.length]), asPub, ct);
}
async function vapidHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const h = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const b = bytesToB64u(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@pododa.kr",
  })));
  const key = await crypto.subtle.importKey("pkcs8", b64uToBytes(env.VAPID_PRIVATE),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(h + "." + b)));
  return `vapid t=${h}.${b}.${bytesToB64u(sig)}, k=${env.VAPID_PUBLIC}`;
}
async function pushTo(env, sub, payloadObj) {
  const body = await encryptPayload(JSON.stringify(payloadObj), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      TTL: "900",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: await vapidHeader(env, sub.endpoint),
    },
    body,
  });
  return res.status;
}
async function notifyOwner(env, slug, payload) {
  if (!env.VAPID_PRIVATE || !env.VAPID_PUBLIC) return;
  const subs = await env.DB.prepare(`SELECT endpoint,p256dh,auth FROM subs WHERE slug=?`).bind(slug).all();
  for (const s of subs.results || []) {
    let st = 0;
    try { st = await pushTo(env, s, payload); } catch { st = 0; }
    if (st === 404 || st === 410) {   /* 만료된 구독 정리 */
      await env.DB.prepare(`DELETE FROM subs WHERE endpoint=?`).bind(s.endpoint).run();
    }
  }
}

/* ── 주문 상태 기계 (앱과 동일 규칙을 서버에서도 강제) ───────── */
const FLOW = { pending: ["accepted", "confirmed", "canceled"], accepted: ["confirmed", "canceled"], confirmed: ["paid"], paid: [], canceled: [] };
const ACTOR = {
  "pending>accepted": ["seller"], "pending>confirmed": ["buyer"], "accepted>confirmed": ["buyer"],
  "confirmed>paid": ["buyer"], "pending>canceled": ["buyer", "seller"], "accepted>canceled": ["seller"],
};

/* ── 라우팅 ──────────────────────────────────────────────────── */
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    try {
      await ensureSchema(env);

      if (p === "/health") return json({ ok: true, ts: Date.now() }, env);

      /* ---------- 사장님 인증 ---------- */
      if (p === "/owner/register" && req.method === "POST") {
        const { slug, pin, invite } = body;
        if (!slug || !/^[0-9]{4,12}$/.test(String(pin || ""))) return bad("slug와 4~12자리 PIN이 필요합니다", env);

        /* 자유 등록이라 아무나 부를 수 있는 경로입니다. IP당 분당 20건으로 묶습니다.
           국내 통신사는 CGNAT 라 여러 사장님이 같은 IP로 잡힐 수 있어 넉넉히 둡니다.
           스크립트 폭격은 수백 건 단위라 이 선에서도 충분히 걸립니다. */
        if (await hitLimit(env, "reg:" + clientIp(req), 20))
          return bad("가입 요청이 너무 많습니다. 1분 후 다시 시도해주세요", env, 429);
        if (!slugOk(slug)) return bad("가게 주소로 쓸 수 없는 이름입니다", env, 400);

        const exist = await env.DB.prepare(`SELECT slug FROM owners WHERE slug=?`).bind(slug).first();
        if (exist) return bad("이미 등록된 가게입니다. 로그인하세요.", env, 409);

        /* ② 자유 등록 — 기본값이 "누구나 등록 가능" 입니다.
           다시 초대제로 되돌리려면 환경변수 INVITE_REQUIRED 를 "1" 로 두세요.
           (기본값을 코드에 둔 이유: 재배포하면 Plaintext 변수가 지워지기 때문입니다.
            변수에 의존하면 배포할 때마다 몰래 초대제로 되돌아갑니다.) */
        if (String(env.INVITE_REQUIRED ?? "0") === "1") {
          const code = String(invite || "").toUpperCase().trim();
          if (!code) return bad("초대코드가 필요합니다", env, 403);
          const inv = await env.DB.prepare(`SELECT code, slug, used FROM invites WHERE code=?`).bind(code).first();
          if (!inv) return bad("초대코드가 올바르지 않습니다", env, 403);
          if (inv.used) return bad("이미 사용된 초대코드입니다", env, 403);
          if (inv.slug && inv.slug !== slug) return bad("이 초대코드는 다른 가게용입니다", env, 403);
          await env.DB.prepare(`UPDATE invites SET used=1 WHERE code=?`).bind(code).run();
        }

        const salt = crypto.randomUUID();
        const recovery = bytesToB64u(crypto.getRandomValues(new Uint8Array(6))).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
        await env.DB.prepare(
          `INSERT INTO owners(slug,salt,hash,rec_hash,fails,lock_until,ts) VALUES(?,?,?,?,0,0,?)`
        ).bind(slug, salt, await pinHash(String(pin), salt), await pinHash(recovery, salt), Date.now()).run();

        /* ③ 목록에 자리를 먼저 잡아둡니다. 이름·메뉴는 곧이어 /store/save 가 채웁니다. */
        await metaUpsert(env, slug, { name: body.name || slug, emoji: body.emoji || "🏪" });

        return json({ ok: true, recovery, token: await issueToken(env, slug) }, env);
      }

      if (p === "/owner/login" && req.method === "POST") {
        const { slug, pin } = body;
        const row = await env.DB.prepare(`SELECT * FROM owners WHERE slug=?`).bind(slug).first();
        if (!row) return bad("등록되지 않은 가게입니다", env, 404);
        if (row.lock_until > Date.now()) return bad("잠시 후 다시 시도해주세요", env, 429);

        if (!timingSafeEq(await pinHash(String(pin || ""), row.salt), row.hash)) {
          const n = (row.fails || 0) + 1;
          await env.DB.prepare(`UPDATE owners SET fails=?, lock_until=? WHERE slug=?`)
            .bind(n >= 5 ? 0 : n, n >= 5 ? Date.now() + 300000 : 0, slug).run();
          return bad("PIN이 맞지 않습니다", env, 401);
        }
        await env.DB.prepare(`UPDATE owners SET fails=0, lock_until=0 WHERE slug=?`).bind(slug).run();
        return json({ ok: true, token: await issueToken(env, slug) }, env);
      }

      if (p === "/owner/recover" && req.method === "POST") {
        const { slug, code, newPin } = body;
        const row = await env.DB.prepare(`SELECT * FROM owners WHERE slug=?`).bind(slug).first();
        if (!row) return bad("등록되지 않은 가게입니다", env, 404);
        if (!timingSafeEq(await pinHash(String(code || "").toUpperCase().trim(), row.salt), row.rec_hash))
          return bad("복구코드가 맞지 않습니다", env, 401);
        if (!/^[0-9]{4,12}$/.test(String(newPin || ""))) return bad("PIN은 숫자 4~12자리입니다", env);

        const salt = crypto.randomUUID();
        const recovery = bytesToB64u(crypto.getRandomValues(new Uint8Array(6))).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
        await env.DB.prepare(`UPDATE owners SET salt=?, hash=?, rec_hash=?, fails=0, lock_until=0 WHERE slug=?`)
          .bind(salt, await pinHash(String(newPin), salt), await pinHash(recovery, salt), slug).run();
        return json({ ok: true, recovery, token: await issueToken(env, slug) }, env);
      }

      /* ---------- 초대코드 발급 ----------
         ADMIN_KEY 를 아는 사람(=운영자)만 코드를 만들 수 있습니다. */
      if (p === "/invite/new" && req.method === "POST") {
        if (!env.ADMIN_KEY || body.adminKey !== env.ADMIN_KEY) return bad("권한이 없습니다", env, 401);
        const code = bytesToB64u(crypto.getRandomValues(new Uint8Array(6)))
          .replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
        await env.DB.prepare(`INSERT INTO invites(code,slug,used,ts) VALUES(?,?,0,?)`)
          .bind(code, body.slug || null, Date.now()).run();
        return json({ ok: true, code, slug: body.slug || null }, env);
      }

      if (p === "/invite/list" && req.method === "POST") {
        if (!env.ADMIN_KEY || body.adminKey !== env.ADMIN_KEY) return bad("권한이 없습니다", env, 401);
        const rows = await env.DB.prepare(`SELECT code, slug, used, ts FROM invites ORDER BY ts DESC LIMIT 100`).all();
        return json({ ok: true, invites: rows.results || [] }, env);
      }

      /* ---------- 재고 ---------- */
      if (p === "/stock" && req.method === "GET") {
        const slug = url.searchParams.get("slug");
        if (!slug) return bad("slug가 필요합니다", env);
        const rows = await env.DB.prepare(`SELECT item, qty FROM stock WHERE slug=?`).bind(slug).all();
        const stock = {};
        (rows.results || []).forEach((r) => { stock[r.item] = r.qty; });
        return json({ ok: true, stock }, env);
      }

      if (p === "/stock/set" && req.method === "POST") {
        const auth = await requireOwner(req, env, body.slug);
        if (!auth.ok) return bad(auth.msg, env, 401);
        if (body.stock === null || body.stock === undefined) {
          await env.DB.prepare(`DELETE FROM stock WHERE slug=? AND item=?`).bind(body.slug, body.itemId).run();
        } else {
          await env.DB.prepare(
            `INSERT INTO stock(slug,item,qty) VALUES(?,?,?)
             ON CONFLICT(slug,item) DO UPDATE SET qty=excluded.qty`
          ).bind(body.slug, body.itemId, Math.max(0, parseInt(body.stock, 10) || 0)).run();
        }
        return json({ ok: true }, env);
      }

      /* ---------- 주문 ---------- */
      if (p === "/orders" && req.method === "POST") {
        const items = body.items || [];
        const slug = body.slug || (items[0] && items[0].slug);
        if (!slug || !body.no) return bad("slug와 주문번호가 필요합니다", env);

        const invalid = checkOrder(body);
        if (invalid) return bad(invalid, env, 400);

        /* 같은 주문번호 재전송은 아래에서 걸러지므로, 속도 제한을 먼저 봅니다 */
        if (await hitLimit(env, `ip:${clientIp(req)}`, LIMITS.PER_MIN_IP))
          return bad("주문이 너무 잦습니다. 잠시 후 다시 시도해주세요", env, 429);
        if (await hitLimit(env, `store:${slug}`, LIMITS.PER_MIN_STORE))
          return bad("주문이 몰리고 있어요. 잠시 후 다시 시도해주세요", env, 429);

        const dup = await env.DB.prepare(`SELECT no FROM orders WHERE slug=? AND no=?`).bind(slug, body.no).first();
        if (dup) return json({ ok: true, duplicate: true }, env);   /* 재전송 안전 */

        const need = needMap(items);
        const take = await takeStock(env, slug, need);
        if (!take.ok) return json({ ok: false, error: "재고 부족", short: take.short }, env, 409);

        const order = {
          ...body, slug, status: "pending", ts: body.ts || Date.now(),
          statusLog: body.statusLog || [{ status: "pending", at: Date.now() }],
        };
        await env.DB.prepare(`INSERT INTO orders(slug,no,status,total,ts,body) VALUES(?,?,?,?,?,?)`)
          .bind(slug, order.no, "pending", order.total || 0, order.ts, JSON.stringify(order)).run();

        await notifyOwner(env, slug, {
          title: `🧾 새 주문 ${Number(order.total || 0).toLocaleString("ko-KR")}원`,
          body: items.map((i) => `${i.name}×${i.qty}`).join(", ") || "주문이 들어왔어요",
          no: order.no, tag: `order-${order.no}`, url: "/#/admin",
        });
        return json({ ok: true, order }, env);
      }

      if (p === "/orders" && req.method === "GET") {
        const slug = url.searchParams.get("slug");
        const auth = await requireOwner(req, env, slug);
        if (!auth.ok) return bad(auth.msg, env, 401);
        const rows = await env.DB.prepare(`SELECT body FROM orders WHERE slug=? ORDER BY ts DESC LIMIT 100`).bind(slug).all();
        return json({ ok: true, orders: (rows.results || []).map((r) => JSON.parse(r.body)) }, env);
      }

      if (p === "/orders/status" && req.method === "POST") {
        const { slug, no, to, by } = body;
        const row = await env.DB.prepare(`SELECT body FROM orders WHERE slug=? AND no=?`).bind(slug, no).first();
        if (!row) return bad("주문을 찾을 수 없습니다", env, 404);
        const od = JSON.parse(row.body);
        const from = od.status || "pending";

        if (!(FLOW[from] || []).includes(to)) return bad(`지금 단계에서는 바꿀 수 없습니다 (${from})`, env, 409);
        const allow = ACTOR[`${from}>${to}`];
        if (allow && !allow.includes(by)) return bad("이 단계를 바꿀 권한이 없습니다", env, 403);
        if (by === "seller") {
          const auth = await requireOwner(req, env, slug);
          if (!auth.ok) return bad(auth.msg, env, 401);
        }
        if (to === "canceled") await giveStock(env, slug, needMap(od.items));

        od.status = to;
        od.statusLog = (od.statusLog || []).concat([{ status: to, at: Date.now(), by: by || "" }]);
        await env.DB.prepare(`UPDATE orders SET status=?, body=? WHERE slug=? AND no=?`)
          .bind(to, JSON.stringify(od), slug, no).run();
        return json({ ok: true, order: od }, env);
      }

      /* ---------- 가게·메뉴 (기기 간 공유) ----------
         손님도 메뉴를 봐야 하므로 조회는 공개, 저장은 사장님만 가능합니다. */
      if (p === "/store" && req.method === "GET") {
        const slug = url.searchParams.get("slug");
        if (!slug) return bad("slug가 필요합니다", env);
        const row = await env.DB.prepare(`SELECT body, updated FROM stores WHERE slug=?`).bind(slug).first();
        if (!row) return json({ ok: true, store: null }, env);
        return json({ ok: true, store: JSON.parse(row.body), updated: row.updated }, env);
      }

      if (p === "/store/save" && req.method === "POST") {
        const auth = await requireOwner(req, env, body.slug);
        if (!auth.ok) return bad(auth.msg, env, 401);
        const st = body.store;
        if (!st || typeof st !== "object") return bad("가게 정보가 없습니다", env);
        const raw = JSON.stringify(st);
        if (raw.length > 400000) return bad("가게 정보가 너무 큽니다 (사진 장수를 줄여주세요)", env, 413);

        /* 다른 기기가 더 최신이면 덮어쓰지 않습니다 */
        const cur = await env.DB.prepare(`SELECT updated FROM stores WHERE slug=?`).bind(body.slug).first();
        const now = Date.now();
        if (cur && body.base && cur.updated > body.base) {
          return json({ ok: false, conflict: true, updated: cur.updated }, env, 409);
        }
        await env.DB.prepare(
          `INSERT INTO stores(slug,body,updated) VALUES(?,?,?)
           ON CONFLICT(slug) DO UPDATE SET body=excluded.body, updated=excluded.updated`
        ).bind(body.slug, raw, now).run();
        await metaUpsert(env, body.slug, st);   /* ③ 공유 목록도 같이 갱신 */
        return json({ ok: true, updated: now }, env);
      }

      /* ③ 가게 목록 서버 공유 —
         손님 앱이 이 목록을 받아 자기 화면의 가게 목록에 합칩니다.
         본문(사진 포함)은 절대 싣지 않습니다. 메뉴는 가게를 열 때 /store 가 줍니다. */
      if ((p === "/stores" || p === "/store/list") && req.method === "GET") {
        await metaBackfill(env);                       /* 패치 전 가게 1회 채우기 */
        const q = (url.searchParams.get("q") || "").trim();
        const cat = (url.searchParams.get("cat") || "").trim();
        const lim = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10) || 200));

        const rows = await env.DB.prepare(
          `SELECT slug,name,emoji,cat,area,paused,menus,updated
           FROM store_meta ORDER BY updated DESC LIMIT ?`
        ).bind(lim).all();

        let list = (rows.results || []).map((r) => ({
          slug: r.slug,
          name: r.name || r.slug,
          emoji: r.emoji || "🏪",
          cat: r.cat || "기타",
          area: r.area || "",
          paused: !!r.paused,
          menuCount: r.menus || 0,
          updated: r.updated || 0,
        }));
        if (cat) list = list.filter((x) => x.cat === cat);
        if (q) list = list.filter((x) => x.name.includes(q) || x.area.includes(q));

        return json({ ok: true, stores: list, count: list.length }, env);
      }

      /* 운영자용 — 목록이 실제와 어긋났을 때 다시 만듭니다 */
      if (p === "/store/reindex" && req.method === "POST") {
        if (!env.ADMIN_KEY || body.adminKey !== env.ADMIN_KEY) return bad("권한이 없습니다", env, 401);
        await env.DB.prepare(`DELETE FROM store_meta`).run();
        const n = await metaBackfill(env);
        return json({ ok: true, reindexed: n }, env);
      }

      /* ---------- 푸시 구독 ---------- */
      if (p === "/push/subscribe" && req.method === "POST") {
        const auth = await requireOwner(req, env, body.slug);
        if (!auth.ok) return bad(auth.msg, env, 401);
        const s = body.sub || {};
        const keys = s.keys || {};
        if (!s.endpoint || !keys.p256dh || !keys.auth) return bad("구독 정보가 올바르지 않습니다", env);
        await env.DB.prepare(
          `INSERT INTO subs(endpoint,slug,p256dh,auth,ts) VALUES(?,?,?,?,?)
           ON CONFLICT(endpoint) DO UPDATE SET slug=excluded.slug, p256dh=excluded.p256dh, auth=excluded.auth, ts=excluded.ts`
        ).bind(s.endpoint, body.slug, keys.p256dh, keys.auth, Date.now()).run();
        return json({ ok: true }, env);
      }

      if (p === "/push/unsubscribe" && req.method === "POST") {
        await env.DB.prepare(`DELETE FROM subs WHERE endpoint=?`).bind(body.endpoint || body.old || "").run();
        return json({ ok: true }, env);
      }

      /* 알림이 실제로 오는지 사장님이 직접 확인 */
      if (p === "/push/test" && req.method === "POST") {
        const auth = await requireOwner(req, env, body.slug);
        if (!auth.ok) return bad(auth.msg, env, 401);
        await notifyOwner(env, body.slug, {
          title: "🔔 알림 테스트", body: "이 알림이 보이면 설정이 끝난 거예요", tag: "test", url: "/#/admin",
        });
        return json({ ok: true }, env);
      }

      return bad("알 수 없는 경로입니다: " + p, env, 404);
    } catch (e) {
      return bad("서버 오류: " + (e && e.message), env, 500);
    }
  },
};
