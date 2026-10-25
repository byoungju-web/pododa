/* =====================================================================
   pododa 크레딧 월 구독 — pd-pay.js (v48: '구독 관리' 화면에 그림)
   · 구글 플레이에서 받은 pododa 앱 안에서만 구독 (구글 결제, 한 달마다 자동 결제)
     - Digital Goods API 로 요금제·가격을 구글에서 받아 오고
     - Payment Request API 로 구글 결제창을 띄운 뒤
     - 받은 구매 토큰을 서버(/api/pay/play/subscribe)로 보내 구글에 확인하고 그 달 크레딧을 받음
   · 다음 달부터는 서버가 구글에 물어 결제된 달마다 크레딧을 자동으로 넣어 줌 (크레딧 화면을 열 때 확인)
   · 남은 크레딧은 다음 달로 넘어감
   · 구독은 한 번에 하나만. 요금제 변경·해지는 구글 플레이 '구독' 화면에서
   · 웹(크롬·데스크탑)에서는 구독 버튼 대신 앱 안내만 보여 줌
   index.html 의 API · authHeaders · refreshToken · crMsg · openCredits 를 씀
   ===================================================================== */
(function () {
  'use strict';
  const VER = 'v48';
  // 서버(PLAY_PLANS_LIST)와 같은 표 — 크레딧 수는 서버가 최종으로 정함
  const PLANS = [
    { id: 'monthly_100', credits: 100, won: 9900 },
    { id: 'monthly_300', credits: 300, won: 29000 },
    { id: 'monthly_550', credits: 550, won: 49000, best: true },
    { id: 'monthly_1200', credits: 1200, won: 99000 }
  ];
  const METHOD = 'https://play.google.com/billing';
  const PKG = 'team.bongboard.vimusay';
  const STORE = 'https://play.google.com/store/apps/details?id=' + PKG;
  const MANAGE = sku => 'https://play.google.com/store/account/subscriptions?package=' + PKG + (sku ? '&sku=' + encodeURIComponent(sku) : '');
  const STATE = {
    SUBSCRIPTION_STATE_ACTIVE: '구독 중',
    SUBSCRIPTION_STATE_CANCELED: '해지 예정',
    SUBSCRIPTION_STATE_IN_GRACE_PERIOD: '결제 확인 필요',
    SUBSCRIPTION_STATE_ON_HOLD: '결제 보류',
    SUBSCRIPTION_STATE_PAUSED: '일시 중지',
    SUBSCRIPTION_STATE_PENDING: '결제 처리 중'
  };
  let svc = null, svcTried = false, prices = {}, busy = false, recovering = false, subs = [];
  const $ = id => document.getElementById(id);
  const msg = (t, err) => { try { crMsg(t, err); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };

  (function css() {
    const s = document.createElement('style');
    s.textContent = `
.pp-list{display:flex;flex-direction:column;gap:10px}
.pp-card{position:relative;text-align:left;width:100%;border:1.5px solid var(--lgray);background:var(--white);border-radius:16px;padding:14px 16px;cursor:pointer;font-family:inherit}
.pp-card:active{transform:scale(.99)}
.pp-card.best{border-color:var(--pri);box-shadow:0 0 0 3px rgba(124,58,237,.12)}
.pp-card.mine{border-color:var(--pri);background:#f7f5fc}
.pp-card[disabled]{cursor:default;opacity:.55}
.pp-card.mine[disabled]{opacity:1}
.pp-badge{display:inline-block;background:var(--pri);color:#fff;font-size:11.5px;font-weight:700;border-radius:10px;padding:2px 9px;margin-bottom:6px}
.pp-cr{font-size:24px;font-weight:800;color:var(--dgray)}
.pp-cr small{font-size:14px;font-weight:500;color:var(--gray);margin-left:4px}
.pp-won{font-size:16px;font-weight:700;margin-top:2px;color:var(--dgray)}
.pp-unit{font-size:12.5px;color:var(--gray)}
.pp-note{font-size:12px;color:var(--gray);line-height:1.6;margin-top:10px}
.pp-out{padding:12px 14px;border-radius:12px;background:#f7f5fc;font-size:13px;line-height:1.6;margin-top:10px}
.pp-out a,.pp-sub a{color:var(--pri);font-weight:700}
.pp-sub{padding:12px 14px;border-radius:14px;border:1.5px solid var(--pri);background:#f7f5fc;font-size:13px;line-height:1.7;margin-bottom:12px}
.pp-sub b{font-size:15px}`;
    document.head.appendChild(s);
  })();

  async function getSvc() {
    if (svcTried) return svc;
    svcTried = true;
    try { if ('getDigitalGoodsService' in window) svc = await window.getDigitalGoodsService(METHOD); } catch (e) { svc = null; }
    return svc;
  }
  async function loadPrices() {
    try { (await svc.getDetails(PLANS.map(p => p.id)) || []).forEach(it => { if (it && it.itemId) prices[it.itemId] = it.price; }); } catch (e) {}
  }
  // 구글이 알려 준 가격이 있으면 그걸, 없으면 정해 둔 가격을 보여 줌
  function priceText(p) {
    const g = prices[p.id];
    if (g && g.value != null) { try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: g.currency || 'KRW' }).format(Number(g.value)); } catch (e) {} }
    return p.won.toLocaleString('ko-KR') + '원';
  }

  function subBox(s) {
    const p = PLANS.find(x => x.id === s.product_id) || { credits: s.credits };
    const st = STATE[s.state] || '구독 중';
    let when = '';
    if (s.expiry) when = s.state === 'SUBSCRIPTION_STATE_CANCELED' || !s.auto_renew
      ? `${day(s.expiry)}까지 이용 · 그 뒤 자동 결제 없음`
      : `다음 결제일 ${day(s.expiry)}`;
    let warn = '';
    if (s.state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' || s.state === 'SUBSCRIPTION_STATE_ON_HOLD')
      warn = '<br><span style="color:#b45309">⚠️ 결제가 되지 않았어요. 구글 플레이에서 결제 수단을 확인해 주세요.</span>';
    return `<div class="pp-sub">💜 <b>매월 ${Number(p.credits).toLocaleString('ko-KR')} 크레딧</b> · ${esc(st)}${s.test ? ' (테스트)' : ''}<br>
      ${esc(when)}${s.months ? ` · ${s.months}달째` : ''}${warn}<br>
      <a href="${MANAGE(s.product_id)}" target="_blank" rel="noopener">구글 플레이에서 구독 관리 · 해지 ›</a></div>`;
  }

  // data: /api/credits 결과 (subs 포함). 없으면 빈 목록
  async function render(data) {
    const box = $('crBuyBox');
    if (!box) return;
    if (data && Array.isArray(data.subs)) subs = data.subs;
    box.innerHTML = '<p style="color:var(--gray)">요금제를 불러오는 중…</p>';
    const s = await getSvc();
    if (s) await loadPrices();
    const cur = subs[0];
    const cards = PLANS.map(p => {
      const mine = cur && cur.product_id === p.id;
      const off = !s || !!cur;
      return `<button type="button" class="pp-card${p.best ? ' best' : ''}${mine ? ' mine' : ''}" data-pp="${p.id}"${off ? ' disabled' : ''}>
        ${mine ? '<span class="pp-badge">지금 구독 중</span><br>' : p.best ? '<span class="pp-badge">가장 많이 선택</span><br>' : ''}
        <span class="pp-cr">매월 ${p.credits.toLocaleString('ko-KR')}<small>크레딧</small></span>
        <div class="pp-won">월 ${priceText(p)}</div>
        <div class="pp-unit">1크레딧당 ${Math.round(p.won / p.credits)}원 · 한 달마다 자동 결제</div></button>`;
    }).join('');
    box.innerHTML = (cur ? subBox(cur) : '') + `<div class="pp-list">${cards}</div>` + (s
      ? `<div class="pp-note">💳 구글 플레이 결제로 <b>한 달마다 자동 결제</b>돼요. 결제 수단은 구글 결제창에서 고를 수 있어요.<br>
         · 결제된 달마다 그 요금제 크레딧이 들어오고, 남은 크레딧은 다음 달로 넘어가요.<br>
         · 구독은 한 번에 하나만 할 수 있어요. 요금제를 바꾸려면 구글 플레이에서 지금 구독을 해지한 뒤 새로 구독해 주세요.<br>
         · 해지는 언제든 구글 플레이 '구독'에서 할 수 있고, 이미 결제한 달이 끝날 때까지는 그대로 이용돼요. 구독 ${VER}</div>`
      : `<div class="pp-out">📱 크레딧 구독은 <b>구글 플레이에서 받은 pododa 앱</b> 안에서 할 수 있어요.<br><a href="${STORE}" target="_blank" rel="noopener">구글 플레이에서 pododa 앱 받기 ›</a>${cur ? `<br><a href="${MANAGE(cur.product_id)}" target="_blank" rel="noopener">구독 관리 · 해지 ›</a>` : ''}</div>`);
    if (s) recover();
  }

  async function send(productId, token) {
    const go = () => fetch(API + '/pay/play/subscribe', { method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ product_id: productId, purchase_token: token }) });
    let r = await go();
    if (r.status === 401 && typeof refreshToken === 'function' && await refreshToken()) r = await go();
    const j = await r.json().catch(() => ({}));
    j._status = r.status;
    return j;
  }

  async function buy(id) {
    const p = PLANS.find(x => x.id === id);
    if (!p || busy) return;
    if (!(await getSvc())) { alert('크레딧 구독은 구글 플레이에서 받은 pododa 앱 안에서 할 수 있어요.'); return; }
    if (subs.length) { alert('이미 구독 중이에요. 요금제를 바꾸려면 구글 플레이에서 지금 구독을 해지한 뒤 새로 구독해 주세요.'); return; }
    busy = true;
    msg('구글 결제창을 여는 중…');
    let resp;
    try {
      const req = new PaymentRequest([{ supportedMethods: METHOD, data: { sku: id } }],
        { total: { label: 'Total', amount: { currency: 'KRW', value: '0' } } });   // 가격은 구글이 정함 (이 값은 쓰이지 않음)
      resp = await req.show();
    } catch (e) {
      busy = false;
      msg(e && e.name === 'AbortError' ? '구독을 취소했어요.' : '결제창을 열지 못했어요: ' + ((e && e.message) || e), !(e && e.name === 'AbortError'));
      return;
    }
    const token = resp && resp.details && resp.details.purchaseToken;
    msg('구독을 확인하는 중… 창을 닫지 말아 주세요.');
    try {
      const j = await send(id, token);
      try { await resp.complete(j.ok || j.pending ? 'success' : 'fail'); } catch (e) {}
      if (j.ok) {
        alert(`💜 구독을 시작했어요! 이번 달 ${Number(j.granted || 0).toLocaleString('ko-KR')} 크레딧이 들어왔어요.${j.sub && j.sub.test ? '\n(테스트 결제)' : ''}\n다음 달부터 결제될 때마다 자동으로 들어와요.`);
        busy = false;
        try { (window.openSubManage || openCredits)(); } catch (e) {}
        return;
      }
      if (j.pending) msg(j.message || '결제가 아직 처리 중이에요. 완료되면 크레딧 화면을 다시 열어 주세요.');
      else msg((j.message || '구독을 확인하지 못했어요.') + ' 결제가 됐다면 크레딧 화면을 다시 열면 자동으로 다시 확인해요.', true);
    } catch (e) {
      try { await resp.complete('fail'); } catch (e2) {}
      msg('인터넷 연결을 확인해 주세요. 결제가 됐다면 크레딧 화면을 다시 열면 자동으로 크레딧을 받아요.', true);
    }
    busy = false;
  }

  // 구독은 됐는데 서버에 아직 연결이 안 된 것(앱이 꺼졌거나 인터넷이 끊긴 경우)을 찾아 연결
  async function recover() {
    if (recovering || !svc || typeof svc.listPurchases !== 'function') return;
    recovering = true;
    let got = 0;
    try {
      const list = await svc.listPurchases();
      for (const it of list || []) {
        if (!it || !PLANS.some(p => p.id === it.itemId) || !it.purchaseToken) continue;
        const j = await send(it.itemId, it.purchaseToken);
        if (j.ok) got += Number(j.granted) || 0;
      }
    } catch (e) {}
    recovering = false;
    if (got > 0) { alert(`💜 구독 크레딧 ${got.toLocaleString('ko-KR')}개를 받았어요.`); try { (window.openSubManage || openCredits)(); } catch (e) {} }
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-pp]');
    if (b && !b.disabled) buy(b.dataset.pp);
  });

  window.pdPay = { render, buy, recover, ver: VER, plans: PLANS, isPlayApp: () => !!svc };
})();
