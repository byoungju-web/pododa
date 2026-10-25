/* =====================================================================
   pododa 동시통역톡 — pd-trans.js (v39)
   · 포도톡과 연결하지 않고 pododa 혼자 돈다 (서버: pododa-api /api/trans/*)
   · 1:1 동시통역: 무료  ·  다중 동시통역: 말한 사람만 크레딧 (번역되는 언어 하나당 0.1)
   · 말하기 = 휴대폰 받아쓰기(SpeechRecognition), 읽어주기 = 휴대폰 읽기(speechSynthesis)
   · 대화는 30일 뒤 자동 삭제
   index.html 의 API · authHeaders · refreshToken · checkLogin · esc · pdToast · currentLang 를 쓴다
   ===================================================================== */
(function () {
  'use strict';

  const VER = 'v42';
  const PRICE = 0.1;      // 다중: 한 마디에 번역되는 언어 하나당
  const KEEP_DAYS = 30;

  // [코드, 이름, 국기, 받아쓰기·읽기 언어]
  const LANGS = [
    ['KO','한국어','🇰🇷','ko-KR'], ['EN','영어','🇺🇸','en-US'], ['VI','베트남어','🇻🇳','vi-VN'], ['ZH','중국어','🇨🇳','zh-CN'],
    ['TH','태국어','🇹🇭','th-TH'], ['JA','일본어','🇯🇵','ja-JP'], ['ID','인도네시아어','🇮🇩','id-ID'], ['UZ','우즈베크어','🇺🇿','uz-UZ'],
    ['NE','네팔어','🇳🇵','ne-NP'], ['MY','미얀마어','🇲🇲','my-MM'], ['KM','캄보디아어','🇰🇭','km-KH'], ['MN','몽골어','🇲🇳','mn-MN'],
    ['TL','필리핀어','🇵🇭','fil-PH'], ['RU','러시아어','🇷🇺','ru-RU'], ['ES','스페인어','🇪🇸','es-ES'], ['FR','프랑스어','🇫🇷','fr-FR'],
    ['DE','독일어','🇩🇪','de-DE'], ['PT','포르투갈어','🇧🇷','pt-BR'], ['IT','이탈리아어','🇮🇹','it-IT'], ['AR','아랍어','🇸🇦','ar-SA'],
    ['HI','힌디어','🇮🇳','hi-IN'], ['NL','네덜란드어','🇳🇱','nl-NL'], ['TR','터키어','🇹🇷','tr-TR'], ['UK','우크라이나어','🇺🇦','uk-UA']
  ];
  const L = c => LANGS.find(x => x[0] === c) || LANGS[0];
  const $ = id => document.getElementById(id);
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const toast = m => { try { pdToast(m); } catch (e) { alert(m); } };
  const H = s => { try { return esc(s); } catch (e) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); } };

  // 초대 링크(pododa.kr/#t=코드)로 들어온 경우: 주소가 지워지기 전에 코드를 챙겨 둔다
  (function grabInvite() {
    const m = String(location.hash || '').match(/^#t=([A-Za-z0-9]{6})$/);
    if (m) ls.set('pd_tr_invite', m[1].toUpperCase());
  })();

  let kind = 'one';           // 지금 보는 칸: one | multi
  let room = null;            // 지금 들어간 방
  let msgs = [], after = 0, pollT = null, polling = false, firstLoad = true;
  let rec = null, sending = false;

  function myLang() {
    let v = ls.get('pd_tr_lang', '');
    if (!LANGS.some(x => x[0] === v)) {
      let g = 'KO';
      try { g = String(currentLang || 'ko').slice(0, 2).toUpperCase(); } catch (e) {}
      v = LANGS.some(x => x[0] === g) ? g : 'KO';
    }
    return v;
  }
  function setMyLang(v) { ls.set('pd_tr_lang', v); }
  const autoRead = () => ls.get('pd_tr_autoread', '1') === '1';

  async function api(path, body) {
    const go = () => fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, authHeaders()),
      body: body ? JSON.stringify(body) : undefined
    });
    let r = await go();
    if (r.status === 401 && typeof refreshToken === 'function' && await refreshToken()) r = await go();
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(r.status === 401 ? '로그인이 만료됐어요. 다시 로그인해 주세요.' : (j.message || j.error || ('오류 ' + r.status)));
      e.code = j.error; e.status = r.status; throw e;
    }
    return j;
  }

  function langOpts(sel) {
    return LANGS.map(x => `<option value="${x[0]}"${x[0] === sel ? ' selected' : ''}>${x[2]} ${x[1]}</option>`).join('');
  }
  function timeOf(s) {
    try { const d = new Date(String(s).replace(' ', 'T') + 'Z'); return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }

  /* ───────────── 화면 꾸밈 ───────────── */
  (function css() {
    const s = document.createElement('style');
    s.textContent = `
#transPage,#transRoomPage{background:#f5f3ff}
.trx-head{height:52px;display:flex;align-items:center;gap:8px;padding:0 10px;background:var(--white);border-bottom:1px solid var(--lgray);flex:none}
.trx-head .bk{font-size:22px;cursor:pointer;padding:4px 6px}
.trx-head .tt{flex:1;min-width:0}
.trx-head .t1{font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trx-head .t2{font-size:11.5px;color:var(--gray);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trx-hb{border:1px solid var(--lgray);background:var(--white);border-radius:16px;padding:5px 9px;font-size:13px;cursor:pointer;white-space:nowrap}
.trx-hb.on{background:var(--pri);color:#fff;border-color:var(--pri)}
.trx-body{flex:1;overflow-y:auto;padding:14px 14px 30px}
.trx-seg{display:flex;gap:6px;background:#ede9fe;border-radius:14px;padding:5px;margin-bottom:12px}
.trx-seg button{flex:1;border:none;background:none;border-radius:10px;padding:10px 4px;font-size:14px;font-weight:700;color:var(--pri);cursor:pointer}
.trx-seg button.on{background:var(--white);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.trx-card{background:var(--white);border-radius:14px;padding:12px 14px;margin-bottom:10px;font-size:13.5px;line-height:1.6;color:#444}
.trx-card label{display:block;font-size:12.5px;color:var(--gray);margin-bottom:6px}
.trx-card select{width:100%;padding:10px;border:1px solid var(--lgray);border-radius:10px;font-size:15px;background:var(--white)}
.trx-btns{display:flex;gap:8px;margin:4px 0 12px}
.trx-btns button{flex:1;padding:13px 6px;border-radius:12px;font-size:14.5px;font-weight:700;cursor:pointer;border:1px solid var(--pri)}
.trx-btns .p{background:var(--pri);color:#fff}
.trx-btns .s{background:var(--white);color:var(--pri)}
.trx-price{font-size:12.5px;color:var(--pri);background:#ede9fe;border-radius:10px;padding:8px 10px;margin-bottom:10px;line-height:1.55}
.trx-row{display:flex;align-items:center;gap:10px;background:var(--white);border-radius:12px;padding:11px 12px;margin-bottom:8px;cursor:pointer}
.trx-row .av{width:42px;height:42px;border-radius:50%;background:#ede9fe;display:flex;align-items:center;justify-content:center;font-size:20px;flex:none}
.trx-row .mid{flex:1;min-width:0}
.trx-row .nm{font-size:14.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trx-row .nm small{font-weight:500;color:var(--gray);font-size:11.5px;margin-left:6px}
.trx-row .ls{font-size:12.5px;color:var(--gray);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trx-row .dot{width:9px;height:9px;border-radius:50%;background:var(--red);flex:none}
.trx-empty{text-align:center;color:var(--gray);font-size:13.5px;padding:28px 0;line-height:1.7}
.trx-empty .e{font-size:42px}
.trx-note{font-size:11.5px;color:var(--gray);line-height:1.6;margin-top:14px;text-align:center}
.trx-msgs{flex:1;overflow-y:auto;padding:12px 10px 16px;display:flex;flex-direction:column;gap:10px}
.trx-sys{align-self:center;font-size:12px;color:var(--gray);background:#ede9fe;border-radius:12px;padding:6px 12px;text-align:center;line-height:1.55;max-width:92%}
.trx-m{max-width:84%;display:flex;flex-direction:column;gap:3px}
.trx-m.me{align-self:flex-end;align-items:flex-end}
.trx-m .who{font-size:11.5px;color:var(--gray);padding:0 4px}
.trx-m .bb{background:var(--white);border-radius:16px;padding:9px 12px;box-shadow:0 1px 2px rgba(0,0,0,.06);-webkit-user-select:text;user-select:text}
.trx-m.me .bb{background:var(--pri);color:#fff}
.trx-m .big{font-size:16px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.trx-m .org{font-size:12px;opacity:.7;margin-top:4px;white-space:pre-wrap;word-break:break-word}
.trx-m .meta{font-size:10.5px;color:var(--gray);padding:0 4px;display:flex;gap:6px;align-items:center}
.trx-m .spk{border:none;background:none;font-size:15px;cursor:pointer;padding:0 2px}
.trx-m .warn{font-size:11px;color:#b45309}
.trx-in{display:flex;gap:6px;padding:8px 8px calc(8px + env(safe-area-inset-bottom));background:var(--white);border-top:1px solid var(--lgray);flex:none}
.trx-in input{flex:1;min-width:0;padding:11px 12px;border:1px solid var(--lgray);border-radius:22px;font-size:15px}
.trx-in button{width:44px;height:44px;border-radius:50%;border:none;font-size:19px;cursor:pointer;flex:none}
.trx-in .mic{background:#ede9fe}
.trx-in .mic.rec{background:var(--red);color:#fff;animation:trxPulse 1s infinite}
.trx-in .snd{background:var(--pri);color:#fff}
@keyframes trxPulse{50%{opacity:.6}}
.trx-lsel{max-width:110px;padding:5px 4px;border:1px solid var(--lgray);border-radius:14px;font-size:12.5px;background:var(--white)}
.trx-sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:260;display:flex;align-items:flex-end;justify-content:center}
.trx-sheet{width:100%;max-width:480px;background:var(--white);border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}
.trx-sheet h4{font-size:16px;margin-bottom:4px}
.trx-sheet .sub{font-size:12.5px;color:var(--gray);margin-bottom:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trx-opt{display:flex;gap:12px;align-items:center;width:100%;text-align:left;border:1px solid var(--lgray);background:var(--white);border-radius:14px;padding:13px 14px;margin-bottom:10px;cursor:pointer}
.trx-opt .ic{font-size:26px}
.trx-opt b{display:block;font-size:15px;color:var(--dgray)}
.trx-opt span{font-size:12.5px;color:var(--gray);line-height:1.45}
.trx-sheet .cancel{width:100%;border:none;background:#f3f4f6;border-radius:12px;padding:12px;font-size:14px;cursor:pointer}
#navTrans{position:relative}
#navTrans .nav-dot{position:absolute;top:6px;right:calc(50% - 18px);width:9px;height:9px;border-radius:50%;background:var(--red);border:2px solid var(--white)}`;
    document.head.appendChild(s);
  })();

  /* ───────────── 목록 화면 ───────────── */
  async function open(k) {
    if (typeof checkLogin === 'function' && !checkLogin()) return;
    kind = k === 'multi' ? 'multi' : 'one';
    $('transPage').classList.add('show');
    renderList([], true);
    loadList();
  }
  function close() {
    closeRoom();
    $('transPage').classList.remove('show');
  }

  let listCache = [], credit = null;
  async function loadList() {
    try {
      const j = await api('/trans/rooms');
      listCache = j.rooms || [];
      if (kind === 'multi') { try { const c = await api('/credits'); credit = c.total; } catch (e) { credit = null; } }
      renderList(listCache, false);
    } catch (e) {
      renderList([], false, e.message);
    }
    joinInvite();
  }

  function renderList(rooms, loading, err) {
    const mine = rooms.filter(r => r.kind === kind);
    const head = `<div class="trx-head"><span class="bk" data-tx="close">←</span>
      <div class="tt"><div class="t1">🌐 동시통역톡</div><div class="t2">각자 자기 말로 · 상대에게는 상대 말로</div></div></div>`;
    const seg = `<div class="trx-seg">
      <button class="${kind === 'one' ? 'on' : ''}" data-tx="seg" data-k="one">🗣️ 1:1 동시통역</button>
      <button class="${kind === 'multi' ? 'on' : ''}" data-tx="seg" data-k="multi">👥 다중 동시통역</button></div>`;
    const lead = kind === 'one'
      ? '서로 <b>떨어져 있을 때</b> 둘이 쓰는 통역이에요. 각자 자기 폰에서 <b>자기 말로만</b> 말하거나 쓰면, 상대 화면에는 상대 언어로 번역돼 보여요.'
      : '<b>여러 사람</b>이 각자 다른 언어로 함께 이야기하는 통역방이에요. 가족·팀·단체 모임에 써 보세요.';
    const price = kind === 'one'
      ? '<div class="trx-price">💜 1:1 동시통역은 <b>무료</b>예요.</div>'
      : `<div class="trx-price">💜 말한 사람만 크레딧을 써요: 한 마디에 번역되는 <b>언어 하나당 ${PRICE}</b> (세 나라 말이면 ${(PRICE * 3).toFixed(1)}). 듣는 사람은 무료예요.${credit != null ? `<br>내 크레딧 <b>${H(String(Math.round(Number(credit || 0) * 10) / 10))}</b> · 모자라면 번역 없이 원문만 전달돼요.` : ''}</div>`;
    const rows = mine.map(r => `<div class="trx-row" data-tx="enter" data-id="${H(r.id)}">
        <div class="av">${r.kind === 'multi' ? '👥' : '🗣️'}</div>
        <div class="mid"><div class="nm">${H(r.name)}<small>👤${r.members} · ${H(r.code)}</small></div>
        <div class="ls">${r.last_text ? H((r.last_nick ? r.last_nick + ': ' : '') + r.last_text) : '아직 대화가 없어요 · 코드를 상대에게 알려 주세요'}</div></div>
        ${r.unread ? '<span class="dot"></span>' : ''}</div>`).join('');
    const list = loading ? '<div class="trx-empty">불러오는 중…</div>'
      : err ? `<div class="trx-empty">목록을 불러오지 못했어요<br>${H(err)}</div>`
      : rows || `<div class="trx-empty"><div class="e">${kind === 'multi' ? '👥' : '🗣️'}</div>아직 통역방이 없어요.<br>＋ 를 눌러 만들고, 코드를 상대에게 알려 주세요.</div>`;
    $('transPage').innerHTML = head + `<div class="trx-body">${seg}
      <div class="trx-card">${lead}</div>
      <div class="trx-card"><label>내 언어 (말하고 읽을 언어)</label><select id="trxMyLang">${langOpts(myLang())}</select></div>
      ${price}
      <div class="trx-btns"><button class="p" data-tx="new">＋ ${kind === 'multi' ? '다중' : '1:1'} 통역방 만들기</button><button class="s" data-tx="code"># 코드로 입장</button></div>
      ${list}
      <div class="trx-note">🔒 통역을 위해 대화 내용이 서버에 저장되고 인공지능(Cloudflare)으로 번역돼요.<br>대화는 <b>${KEEP_DAYS}일이 지나면 자동으로 지워져요.</b> 통역방은 만든 사람이 삭제할 때까지 남아요.<br>동시통역톡 ${VER}</div>
    </div>`;
    const sel = $('trxMyLang');
    if (sel) sel.onchange = () => { setMyLang(sel.value); toast(L(sel.value)[2] + ' ' + L(sel.value)[1] + '로 맞췄어요. 새로 들어가는 방부터 적용돼요'); };
  }

  async function createRoom() {
    const def = kind === 'multi' ? '다중 통역방' : '1:1 통역방';
    const nm = prompt('통역방 이름을 정해 주세요\n(초대받은 사람에게도 이 이름으로 보여요)', def);
    if (nm === null) return;
    try {
      const j = await api('/trans/rooms', { name: (nm || '').trim() || def, kind, lang: myLang() });
      enterRoom(j.room.id, j.room);
    } catch (e) { toast(e.message); }
  }
  async function joinByCode(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) { toast('코드는 영문·숫자 6자리예요'); return; }
    try {
      const j = await api('/trans/join', { code, lang: myLang() });
      kind = j.room.kind === 'multi' ? 'multi' : 'one';
      $('transPage').classList.add('show');
      enterRoom(j.room.id, j.room);
    } catch (e) { toast(e.message); }
  }
  // 초대 링크로 들어온 코드가 있으면 (로그인 뒤) 물어보고 입장
  function joinInvite() {
    const code = ls.get('pd_tr_invite', '');
    if (!code) return;
    ls.set('pd_tr_invite', '');
    if (confirm(`초대받은 통역방에 들어갈까요?\n코드 ${code}`)) joinByCode(code);
  }

  /* ───────────── 대화방 ───────────── */
  function enterRoom(id, info) {
    stopPoll(); micStop();
    room = Object.assign({ id }, info || {});
    msgs = []; after = 0; firstLoad = true;
    $('transRoomPage').classList.add('show');
    renderRoomShell();
    poll(true);
    pollT = setInterval(() => { if (document.visibilityState === 'visible') poll(false); }, 3000);
  }
  function closeRoom() {
    stopPoll(); micStop();
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) {}
    const was = !!room;
    room = null;
    $('transRoomPage').classList.remove('show');
    $('transRoomPage').innerHTML = '';
    if (was && $('transPage').classList.contains('show')) loadList();
    if (was) setTimeout(checkUnread, 300);
  }
  function stopPoll() { if (pollT) clearInterval(pollT); pollT = null; }

  function roomSub() {
    const ms = (room && room.members) || [];
    const flags = ms.map(m => L(m.lang)[2]).join(' ');
    return `${ms.length || 1}명 ${flags} · 코드 ${room && room.code ? room.code : '-'}${room && room.kind === 'multi' ? ' · 말할 때 언어당 ' + PRICE : ' · 무료'}`;
  }
  function renderRoomShell() {
    const me = myLang();
    $('transRoomPage').innerHTML = `<div class="trx-head"><span class="bk" data-tx="back">←</span>
      <div class="tt"><div class="t1" id="trxTitle">${H((room && room.name) || '통역방')}</div><div class="t2" id="trxSub">${H(roomSub())}</div></div>
      <select class="trx-lsel" id="trxRoomLang" title="내 언어">${langOpts(me)}</select>
      <button class="trx-hb${autoRead() ? ' on' : ''}" id="trxAuto" data-tx="auto" title="받은 말 자동 읽기">🔊</button>
      <button class="trx-hb" data-tx="invite" title="초대">📤</button>
      <button class="trx-hb" data-tx="menu" title="더보기">⋮</button></div>
      <div class="trx-msgs" id="trxMsgs"><div class="trx-sys">불러오는 중…</div></div>
      <div class="trx-in"><input id="trxInput" maxlength="500" autocomplete="off" placeholder="${H(L(me)[1])}로 말하거나 입력하세요">
        <button class="mic" id="trxMic" data-tx="mic" title="말하기">🎙️</button>
        <button class="snd" data-tx="send" title="보내기">➤</button></div>`;
    const inp = $('trxInput');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } });
    const ls2 = $('trxRoomLang');
    ls2.onchange = async () => {
      const v = ls2.value;
      try {
        await api('/trans/lang', { room_id: room.id, lang: v });
        setMyLang(v);
        inp.placeholder = L(v)[1] + '로 말하거나 입력하세요';
        toast(L(v)[2] + ' ' + L(v)[1] + '로 바꿨어요. 이제부터 오는 말이 이 언어로 번역돼요');
        msgs = []; after = 0; firstLoad = true; poll(true);
      } catch (e) { toast(e.message); ls2.value = myLang(); }
    };
  }

  async function poll(first) {
    if (!room || polling) return;
    polling = true;
    const rid = room.id;
    try {
      const j = await api('/trans/msgs?room=' + encodeURIComponent(rid) + (after && !first ? '&after=' + after : ''));
      if (!room || room.id !== rid) return;
      if (j.room) {
        Object.assign(room, j.room);
        const t = $('trxTitle'), s = $('trxSub');
        if (t) t.textContent = room.name || '통역방';
        if (s) s.textContent = roomSub();
      }
      if (j.lang && $('trxRoomLang') && $('trxRoomLang').value !== j.lang) { $('trxRoomLang').value = j.lang; setMyLang(j.lang); }
      const got = j.msgs || [];
      if (first) msgs = got; else if (got.length) {
        const have = new Set(msgs.map(m => m.id));
        got.forEach(m => { if (!have.has(m.id)) msgs.push(m); });
      }
      if (msgs.length) after = msgs[msgs.length - 1].id;
      if (first || got.length) paint(first);
      // 새로 들어온 상대 말 자동 읽기 (처음 불러온 지난 대화는 읽지 않음)
      if (!first && !firstLoad && autoRead()) got.filter(m => !m.me).forEach(m => speak(m.tr || m.text, m.tr ? myLang() : m.lang));
      firstLoad = false;
    } catch (e) {
      if (e.status === 403) { toast('이 통역방에서 나와졌어요'); closeRoom(); }
    } finally { polling = false; }
  }

  function paint(force) {
    const box = $('trxMsgs');
    if (!box) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    let html = '';
    const ms = (room && room.members) || [];
    if (ms.length < 2) {
      html += `<div class="trx-sys">상대가 아직 없어요. <b>📤 초대</b>를 눌러 링크를 보내거나<br>코드 <b>${H(room.code || '')}</b> 를 알려 주세요.</div>`;
    }
    if (!msgs.length) html += `<div class="trx-sys">🎙️ 를 누르고 ${H(L(myLang())[1])}로 말해 보세요.<br>말이 끝나면 자동으로 보내져요.</div>`;
    html += msgs.map(m => {
      const show = m.me ? m.text : (m.tr || m.text);
      const sub = !m.me && m.tr ? `<div class="org">${L(m.lang)[2]} ${H(m.text)}</div>` : '';
      const speakLang = m.me ? m.lang : (m.tr ? myLang() : m.lang);
      const warn = m.nocredit ? `<span class="warn">${m.me ? '⚠️ 크레딧이 모자라 번역 없이 보냈어요' : '⚠️ 번역 안 됨 (보낸 사람 크레딧 부족)'}</span>` : '';
      return `<div class="trx-m${m.me ? ' me' : ''}">
        ${m.me ? '' : `<div class="who">${L(m.lang)[2]} ${H(m.nick || '')}</div>`}
        <div class="bb"><div class="big">${H(show)}</div>${sub}</div>
        <div class="meta"><span>${H(timeOf(m.created_at))}</span><button class="spk" data-tx="speak" data-id="${m.id}" data-l="${speakLang}" title="읽어주기">🔊</button>${warn}</div></div>`;
    }).join('');
    box.innerHTML = html;
    if (force || near) box.scrollTop = box.scrollHeight;
  }

  async function send() {
    const inp = $('trxInput');
    if (!inp || !room || sending) return;
    const text = inp.value.trim();
    if (!text) return;
    sending = true;
    inp.value = '';
    try {
      const j = await api('/trans/send', { room_id: room.id, text });
      if (j.nocredit) toast('크레딧이 모자라서 번역 없이 원문만 보냈어요. MY → 내 크레딧을 확인해 주세요');
      else if (j.failed && j.failed.length) toast('일부 언어는 번역하지 못했어요: ' + j.failed.map(c => L(c)[1]).join(', '));
      await poll(false);
    } catch (e) {
      inp.value = text;
      toast(e.message);
    } finally { sending = false; }
  }

  /* ───────────── 말하기 · 읽어주기 ───────────── */
  function micStop() {
    if (rec) {
      try { rec.onresult = rec.onend = rec.onerror = null; } catch (e) {}
      try { rec.abort(); } catch (e) {}
    }
    rec = null;
    const b = $('trxMic'); if (b) b.classList.remove('rec');
  }
  function micStart() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('이 브라우저는 받아쓰기를 지원하지 않아요. 글자로 입력해 주세요'); return; }
    if (rec) { micStop(); return; }
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) {}
    const lang = myLang();
    let got = '';
    try {
      rec = new SR();
      rec.lang = L(lang)[3];
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = ev => {
        let it = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) got += t; else it += t;
        }
        const inp = $('trxInput'); if (inp) inp.value = (got + it).trim();
      };
      rec.onerror = ev => { micStop(); if (ev && ev.error === 'not-allowed') toast('마이크 권한을 허용해 주세요'); };
      rec.onend = () => {
        const inp = $('trxInput'); const v = inp ? inp.value.trim() : '';
        micStop();
        if (v) send();                         // 말이 끝나면 바로 보낸다
      };
      rec.start();
      const b = $('trxMic'); if (b) b.classList.add('rec');
      toast('🎙️ ' + L(lang)[2] + ' ' + L(lang)[1] + '로 듣는 중… 말이 끝나면 자동으로 보내요');
    } catch (e) { micStop(); toast('마이크를 시작할 수 없어요'); }
  }
  function speak(text, lang) {
    if (!text || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    try {
      if (rec) return;                          // 듣는 중에는 읽지 않음
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = L(lang)[3];
      const v = (speechSynthesis.getVoices() || []).find(x => x.lang && x.lang.replace('_', '-').toLowerCase().indexOf(L(lang)[3].slice(0, 2).toLowerCase()) === 0);
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  try { window.speechSynthesis && speechSynthesis.getVoices(); } catch (e) {}

  /* ───────────── 초대 · 메뉴 ───────────── */
  async function invite() {
    if (!room) return;
    const url = location.origin + '/#t=' + room.code;
    const text = `pododa 동시통역톡 "${room.name}"에 초대해요.\n각자 자기 말로 이야기하면 서로의 언어로 번역돼요.\n코드: ${room.code}\n${url}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'pododa 동시통역톡', text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('초대 문구를 복사했어요. 카톡 등에 붙여넣어 보내 주세요'); }
    catch (e) { prompt('아래 내용을 복사해서 보내 주세요', text); }
  }
  async function menu() {
    if (!room) return;
    const owner = !!room.is_owner;
    const c = prompt(`"${room.name}"\n코드 ${room.code}\n\n1 = 초대하기\n2 = 이 방에서 나가기` + (owner ? '\n3 = 방 삭제 (만든 사람만)' : '') + '\n\n번호를 적어 주세요', '');
    if (c === '1') return invite();
    if (c === '2') {
      const msg = owner
        ? '이 통역방에서 나갈까요?\n방은 그대로 남아요. 같은 코드로 다시 들어올 수 있어요.\n방을 없애려면 3번 "방 삭제"를 고르세요.'
        : '이 통역방에서 나갈까요?\n방은 그대로 남고, 같은 코드로 다시 들어올 수 있어요.';
      if (!confirm(msg)) return;
      try { await api('/trans/leave', { room_id: room.id }); toast('통역방에서 나왔어요'); closeRoom(); }
      catch (e) { toast(e.message); }
    }
    if (c === '3' && owner) {
      if (!confirm(`"${room.name}" 방을 삭제할까요?\n들어와 있는 모든 사람의 대화가 함께 지워지고 되돌릴 수 없어요.`)) return;
      try { await api('/trans/delete', { room_id: room.id }); toast('통역방을 삭제했어요'); closeRoom(); }
      catch (e) { toast(e.message); }
    }
  }

  /* ───────────── 누르기 처리 ───────────── */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-tx]');
    if (!b || !b.closest('#transPage, #transRoomPage')) return;
    const a = b.dataset.tx;
    if (a === 'close') { if (typeof closeTrans === 'function') closeTrans(); else close(); }
    else if (a === 'back') closeRoom();
    else if (a === 'seg') { kind = b.dataset.k; renderList(listCache, false); if (kind === 'multi') loadList(); try { setNavActive(); } catch (er) {} }
    else if (a === 'new') createRoom();
    else if (a === 'code') { const c = prompt('받은 통역방 코드 6자리를 입력해 주세요', ''); if (c) joinByCode(c); }
    else if (a === 'enter') { const r = listCache.find(x => x.id === b.dataset.id); enterRoom(b.dataset.id, r ? { name: r.name, code: r.code, kind: r.kind } : null); }
    else if (a === 'send') send();
    else if (a === 'mic') micStart();
    else if (a === 'speak') { const m = msgs.find(x => String(x.id) === b.dataset.id); if (m) speak(m.me ? m.text : (m.tr || m.text), b.dataset.l); }
    else if (a === 'auto') { const on = !autoRead(); ls.set('pd_tr_autoread', on ? '1' : '0'); b.classList.toggle('on', on); toast(on ? '🔊 받은 말을 자동으로 읽어 줘요' : '자동 읽기를 껐어요 · 🔊 를 누르면 하나씩 읽어 줘요'); }
    else if (a === 'invite') invite();
    else if (a === 'menu') menu();
  });
  function setNavActive() {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const n = $('navTrans'); if (n) n.classList.add('active');
  }

  /* ───────────── v41 글에서 통역방 열기 ───────────── */
  // 상점 '채팅하기' → 글쓴이와 1:1 통역방 / 자연 '대화하기' → 1:1 또는 그 글의 다중 이야기방
  // 방 화면만 띄우므로, 뒤로 가면 보던 글로 돌아간다
  const isMine = post => { try { return !!currentUser && String(currentUser.id) === String(post.user_id); } catch (e) { return false; } };
  // 오류는 2초짜리 안내 대신 창으로 확실히 보여 줌 (v42)
  function showErr(e) {
    if (e && e.status === 404 && e.code === 'not_found') {
      alert('통역 서버가 아직 옛 버전이에요.\nCloudflare 에서 pododa-api 워커를 새 파일로 다시 올려(Deploy) 주세요.');
    } else alert((e && e.message) || '통역방을 열지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  }
  async function openForPost(post, k) {
    if (typeof checkLogin === 'function' && !checkLogin()) return;
    if (!post || !post.id) return;
    if (k !== 'multi' && isMine(post)) { ownPostSheet(post); return; }   // 내 글: 나에게 온 대화 목록
    try {
      toast(k === 'multi' ? '이야기방을 여는 중…' : '통역방을 여는 중…');
      const j = await api('/trans/post', { post_id: post.id, kind: k === 'multi' ? 'multi' : 'one', lang: myLang() });
      kind = j.room.kind === 'multi' ? 'multi' : 'one';
      enterRoom(j.room.id, j.room);
    } catch (e) { showErr(e); }
  }
  function sheet(html, onPick) {
    const old = $('trxSheet'); if (old) old.remove();
    const bg = document.createElement('div');
    bg.className = 'trx-sheet-bg'; bg.id = 'trxSheet';
    bg.innerHTML = `<div class="trx-sheet">${html}<button class="cancel">닫기</button></div>`;
    bg.addEventListener('click', e => {
      const o = e.target.closest('.trx-opt');
      if (o) { bg.remove(); onPick(o); return; }
      if (e.target === bg || e.target.closest('.cancel')) bg.remove();
    });
    document.body.appendChild(bg);
    return bg;
  }
  function chooseForPost(post) {
    if (typeof checkLogin === 'function' && !checkLogin()) return;
    if (!post || !post.id) return;
    if (isMine(post)) { ownPostSheet(post, true); return; }
    sheet(`<h4>💬 어떻게 대화할까요?</h4><div class="sub">${H(post.title || '')}</div>
      <button class="trx-opt" data-k="one"><span class="ic">🗣️</span><div><b>1:1 동시통역</b><span>글쓴이와 둘이 대화해요 · 무료</span></div></button>
      <button class="trx-opt" data-k="multi"><span class="ic">👥</span><div><b>다중 동시통역 · 이야기방</b><span>이 글에 관심 있는 여러 사람과 함께 대화해요 · 말할 때 언어당 ${PRICE} 크레딧</span></div></button>`,
      o => openForPost(post, o.dataset.k));
  }
  // v42: 내 글에서 채팅하기·대화하기 → 이 글로 나에게 온 1:1 대화들 (+ 자연은 이야기방 열기)
  async function ownPostSheet(post, withStory) {
    const bg = sheet(`<h4>📬 내 글에 온 대화</h4><div class="sub">${H(post.title || '')}</div><div id="trxOwnList"><div class="trx-empty" style="padding:14px 0">불러오는 중…</div></div>`,
      o => {
        if (o.dataset.k === 'multi') { openForPost(post, 'multi'); return; }
        const r = listCache.find(x => x.id === o.dataset.id);
        kind = 'one'; enterRoom(o.dataset.id, r ? { name: r.name, code: r.code, kind: r.kind } : null);
      });
    let rooms = [];
    try { const j = await api('/trans/rooms'); listCache = j.rooms || []; rooms = listCache.filter(r => String(r.post_id) === String(post.id) && r.kind === 'one'); }
    catch (e) { const box = bg.querySelector('#trxOwnList'); if (box) box.innerHTML = `<div class="trx-empty" style="padding:14px 0">${H(e.status === 404 ? '통역 서버가 아직 옛 버전이에요. pododa-api 워커를 다시 올려 주세요.' : e.message)}</div>`; return; }
    const box = bg.querySelector('#trxOwnList');
    if (!box) return;
    box.innerHTML = (rooms.length ? rooms.map(r => `<button class="trx-opt" data-id="${H(r.id)}"><span class="ic">🗣️</span><div>
        <b>${H(r.peer_nick || '상대')}${r.unread ? ' <span style="color:var(--red)">●</span>' : ''}</b>
        <span>${H(r.last_text ? (r.last_nick ? r.last_nick + ': ' : '') + r.last_text : '아직 대화가 없어요')}</span></div></button>`).join('')
      : `<div class="trx-empty" style="padding:10px 0 16px">아직 이 글로 대화를 건 사람이 없어요.<br>누가 ${withStory ? '대화하기' : '채팅하기'}를 누르면 여기와 <b>통역톡</b>에 나타나요.</div>`)
      + (withStory ? `<button class="trx-opt" data-k="multi"><span class="ic">👥</span><div><b>이 글의 이야기방 열기</b><span>다중 동시통역 · 이 글에 관심 있는 사람들과 함께</span></div></button>` : '');
  }

  /* ───────────── v41 안 읽은 통역 대화 → 하단 통역톡에 빨간 점 ───────────── */
  async function checkUnread() {
    try {
      if (!currentUser || !localStorage.getItem('pd_token') || document.visibilityState !== 'visible') return;
      const j = await api('/trans/rooms');
      listCache = j.rooms || listCache;
      const any = (j.rooms || []).some(r => r.unread && (!room || r.id !== room.id));
      const nav = $('navTrans');
      if (!nav) return;
      let d = nav.querySelector('.nav-dot');
      if (any && !d) { d = document.createElement('span'); d.className = 'nav-dot'; nav.appendChild(d); }
      if (!any && d) d.remove();
    } catch (e) {}
  }
  setInterval(checkUnread, 30000);
  window.addEventListener('load', () => setTimeout(checkUnread, 2500));

  // 초대 링크로 앱을 열었고 이미 로그인돼 있으면 바로 물어봄 (로그인 전이면 통역 버튼을 누를 때)
  window.addEventListener('load', () => {
    setTimeout(() => {
      try { if (ls.get('pd_tr_invite', '') && currentUser) { kind = 'one'; open('one'); } } catch (e) {}
    }, 800);
  });

  window.pdTrans = { open, close, closeRoom, openForPost, chooseForPost, ownPostSheet, checkUnread, ver: VER, get kind() { return kind; } };
})();
