// ============================================
// pododa.kr 글로벌 커머스 플랫폼 - API Worker
// Cloudflare Worker + D1 + R2
// ============================================
// 바인딩 필요:
//   DB   → D1 pododa-db
//   MEDIA → R2 pododa-media
// 설정값 (Workers → pododa-api → Settings → Variables and Secrets):
//   JWT_SECRET        로그인 표 서명용 (이미 있음)
//   GOOGLE_CLIENT_ID  구글 로그인 (pododa 전용 OAuth 클라이언트 ID)
//   RESEND_API_KEY    이메일 인증 코드 발송 (Secret 으로)
//   MAIL_FROM         보내는 사람, 예: pododa <login@pododa.kr>
//   ADMIN_EMAILS      (선택) 크레딧 관리자 이메일, 쉼표로 여러 개. 없으면 hasin7jk@gmail.com
//   CREDIT_WON        (선택) 유료 크레딧 1개의 환불 금액(원). 없으면 100
// v25: coverfo 계정·크레딧과 분리 — SUPABASE_URL·SUPABASE_ANON 은 더 이상 쓰지 않음
// ============================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS
    if (method === 'OPTIONS') return corsResponse();

    // R2 사진 내보내기: GET /media/<저장 경로>
    if (path.startsWith('/media/') && (method === 'GET' || method === 'HEAD')) {
      return serveMedia(decodeURIComponent(path.slice('/media/'.length)), request, env);
    }

    // API 라우팅
    if (!path.startsWith('/api')) {
      return new Response('Not Found', { status: 404 });
    }

    try {
      // --- 인증 파싱 (옵션) ---
      let userId = null;
      const auth = request.headers.get('Authorization');
      if (auth && auth.startsWith('Bearer ')) {
        userId = await verifyToken(auth.slice(7), env);
      }

      // ===== 게시글 =====
      // GET /api/posts — 목록
      if (path === '/api/posts' && method === 'GET') {
        return cors(await getPosts(url, env, userId, request));
      }
      // POST /api/posts — 등록
      if (path === '/api/posts' && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await createPost(request, userId, env));
      }
      // GET /api/posts/:id — 상세
      const detailMatch = path.match(/^\/api\/posts\/(\d+)$/);
      if (detailMatch && method === 'GET') {
        return cors(await getPostDetail(parseInt(detailMatch[1]), env));
      }
      // POST /api/posts/:id/view — 조회수
      const viewMatch = path.match(/^\/api\/posts\/(\d+)\/view$/);
      if (viewMatch && method === 'POST') {
        return cors(await incrementView(parseInt(viewMatch[1]), env));
      }
      // POST /api/posts/:id/like — 찜
      const likeMatch = path.match(/^\/api\/posts\/(\d+)\/like$/);
      if (likeMatch && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await toggleLike(parseInt(likeMatch[1]), userId, env));
      }
      // POST /api/posts/:id/offer — 가격 제안
      const offerMatch = path.match(/^\/api\/posts\/(\d+)\/offer$/);
      if (offerMatch && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await createOffer(parseInt(offerMatch[1]), userId, request, env));
      }

      // ===== 채팅 =====
      // GET /api/chat/rooms — 내 채팅방 목록
      if (path === '/api/chat/rooms' && method === 'GET') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await getChatRooms(userId, env));
      }
      // POST /api/chat/rooms — 새 채팅방 + 첫 메시지
      if (path === '/api/chat/rooms' && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await createChatRoom(userId, request, env));
      }
      // GET /api/chat/:roomId/msgs — 메시지 목록
      const msgsMatch = path.match(/^\/api\/chat\/([^/]+)\/msgs$/);
      if (msgsMatch && method === 'GET') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await getChatMessages(msgsMatch[1], userId, env));
      }
      // POST /api/chat/:roomId/msgs — 메시지 전송
      if (msgsMatch && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await sendChatMessage(msgsMatch[1], userId, request, env));
      }

      // ===== 검색 =====
      if (path === '/api/search' && method === 'GET') {
        return cors(await searchPosts(url, env));
      }

      // ===== 사용자 프로필 =====
      if (path === '/api/me' && method === 'GET') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await getMyProfile(userId, env));
      }
      if (path === '/api/me' && method === 'PUT') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await updateProfile(userId, request, env));
      }
      // v21 내 게시글 · 찜 목록
      if (path === '/api/me/posts' && method === 'GET') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await getMyPosts(userId, env));
      }
      if (path === '/api/me/likes' && method === 'GET') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await getMyLikes(userId, env));
      }
      // v25 회원 탈퇴 (pododa 계정만): 크레딧 확인 · 탈퇴 실행
      if (path === '/api/me/withdraw-plan' && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await withdrawPlan(userId, env));
      }
      if (path === '/api/me/withdraw' && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await withdraw(userId, request, env));
      }

      // ===== v25 pododa 전용 로그인 (구글 · 이메일 인증 코드) =====
      if (path === '/api/auth/config' && method === 'GET') {
        return cors(authConfig(env));
      }
      if (path === '/api/auth/google' && method === 'POST') {
        return cors(await authGoogle(request, env));
      }
      if (path === '/api/auth/email/start' && method === 'POST') {
        return cors(await authEmailStart(request, env));
      }
      if (path === '/api/auth/email/verify' && method === 'POST') {
        return cors(await authEmailVerify(request, env));
      }
      if (path === '/api/auth/refresh' && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await authRefresh(userId, env));
      }

      // ===== v25 pododa 크레딧 =====
      if (path === '/api/credits' && method === 'GET') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await myCredits(userId, env));
      }
      if (path === '/api/credits/refund' && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await refundRequest(userId, request, env));
      }
      // 관리자 (ADMIN_EMAILS 에 든 이메일로 로그인했을 때만)
      if (path.startsWith('/api/admin/')) {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        if (!(await isAdmin(userId, env))) return cors(json({ error: 'forbidden' }, 403));
        if (path === '/api/admin/credits' && method === 'GET') return cors(await adminCredits(url, env));
        if (path === '/api/admin/credits/grant' && method === 'POST') return cors(await adminGrant(userId, request, env));
        const rf = path.match(/^\/api\/admin\/refunds\/(\d+)$/);
        if (rf && method === 'POST') return cors(await adminRefund(userId, parseInt(rf[1]), request, env));
      }

      // ===== 이미지 업로드 =====
      if (path === '/api/upload' && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await uploadImage(request, userId, env));
      }

      // ===== 알림 =====
      if (path === '/api/notifications' && method === 'GET') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await getNotifications(userId, env));
      }

      // ===== 위치 동의 철회: 위치정보 이용·제공사실 확인자료 파기 (위치기반서비스 이용약관 제6조) =====
      if (path === '/api/location' && method === 'DELETE') {
        return cors(await deleteLocationLog(url, userId, env));
      }

      // ===== 신고 =====
      if (path === '/api/report' && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await createReport(userId, request, env));
      }

      return cors(json({ error: 'not_found' }, 404));
    } catch (e) {
      return cors(json({ error: 'server_error', message: e.message }, 500));
    }
  }
};


// ========================================
// 게시글 (Posts)
// ========================================

async function getPosts(url, env, userId, request) {
  const cat = url.searchParams.get('cat') || '0';
  const nation = url.searchParams.get('nation') || '';
  const sub = url.searchParams.get('sub');
  const sort = url.searchParams.get('sort') || 'recent';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 20;
  const offset = (page - 1) * limit;

  let where = 'p.is_deleted = 0 AND p.category = ?';
  let params = [parseInt(cat)];

  // 자연(4)이 아니면 국가 필터
  if (parseInt(cat) !== 4 && nation) {
    where += ' AND p.nation_code = ?';
    params.push(nation);
  }
  // 서브 카테고리
  if (sub !== null && sub !== undefined && sub !== '' && sub !== '-1') {
    where += ' AND p.sub_cate = ?';
    params.push(parseInt(sub));
  }

  // ── 거리 검색 (시장·상점·배달·내주변): 이용자 위치는 이 요청 처리에만 쓰고 저장하지 않는다 (이용 기록만 남김) ──
  const near = nearbyParams(url, cat);
  if (near) {
    const dLat = near.r / 111;
    const dLng = near.r / (111 * Math.max(0.1, Math.cos(near.lat * Math.PI / 180)));
    const nsql = `SELECT p.*, u.nickname, u.profile_img, u.trust_score
      FROM pd_posts p LEFT JOIN pd_users u ON p.user_id = u.id
      WHERE ${where} AND p.lat BETWEEN ? AND ? AND p.lng BETWEEN ? AND ? AND NOT (p.lat = 0 AND p.lng = 0)
      ORDER BY p.created_at DESC LIMIT 500`;
    const nparams = params.concat([near.lat - dLat, near.lat + dLat, near.lng - dLng, near.lng + dLng]);
    const { results } = await env.DB.prepare(nsql).bind(...nparams).all();
    const within = (results || [])
      .map(p => ({ p, d: distKm(near.lat, near.lng, p.lat, p.lng) }))
      .filter(x => x.d <= near.r)
      .sort((a, b) => a.d - b.d);
    await logLocationUse(env, userId || (near.dev ? 'dev:' + near.dev : 'anon'), request, 'pododa-nearby', '');
    const pageRows = within.slice(offset, offset + limit).map(x => ({ ...publicPost(x.p), dist: Math.round(x.d * 10) / 10 }));
    return json({ posts: pageRows, page, hasMore: within.length > offset + limit, nearby: true });
  }

  let orderBy = 'p.created_at DESC';
  if (sort === 'popular') orderBy = 'p.like_count DESC, p.created_at DESC';
  else if (sort === 'price_low') orderBy = "CAST(p.price AS REAL) ASC";
  else if (sort === 'price_high') orderBy = "CAST(p.price AS REAL) DESC";

  const sql = `SELECT p.*, u.nickname, u.profile_img, u.trust_score
    FROM pd_posts p LEFT JOIN pd_users u ON p.user_id = u.id
    WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json({ posts: (results || []).map(publicPost), page, hasMore: (results || []).length === limit });
}


async function createPost(request, userId, env) {
  const ct = request.headers.get('Content-Type') || '';
  let data;
  let imageUrls = [];

  if (ct.includes('multipart/form-data')) {
    const formData = await request.formData();
    data = {};
    for (const [key, val] of formData.entries()) {
      if (key === 'images' && val instanceof File) {
        // R2에 업로드
        const ext = val.name.split('.').pop() || 'jpg';
        const filename = `posts/${userId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
        await env.MEDIA.put(filename, val.stream(), {
          httpMetadata: { contentType: val.type }
        });
        imageUrls.push(`${new URL(request.url).origin}/media/${filename}`);
      } else {
        data[key] = val;
      }
    }
  } else {
    data = await request.json();
  }

  const searchText = `${data.title || ''} ${data.body || ''} ${data.address || ''}`.toLowerCase();

  // 글 위치: 소수 둘째 자리(약 1km)로 줄여 저장. 다른 이용자에게는 좌표를 내보내지 않고 거리만 보여 준다
  const pLat = roundLoc(data.lat, 90), pLng = roundLoc(data.lng, 180);
  const hasLoc = !(pLat === 0 && pLng === 0);

  const sql = `INSERT INTO pd_posts
    (user_id, category, sub_cate, nation_code, lang_code, title, body, price, currency,
     images, lat, lng, address, phone, opening_hours, moq, company_info,
     sale_status, search_text, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`;

  const result = await env.DB.prepare(sql).bind(
    userId,
    parseInt(data.category || 0),
    parseInt(data.sub_cate || 0),
    data.nation_code || 'KR',
    data.lang_code || 'ko',
    data.title || '',
    data.body || '',
    data.price || '',
    data.currency || 'KRW',
    JSON.stringify(imageUrls),
    hasLoc ? pLat : 0,
    hasLoc ? pLng : 0,
    data.address || '',
    data.phone || '',
    data.opening_hours || '',
    data.moq || '',
    data.company_info || '',
    parseInt(data.sale_status || 0),
    searchText
  ).run();

  if (hasLoc) await logLocationUse(env, userId, request, 'pododa-post-location', '');
  return json({ ok: true, id: result.meta?.last_row_id });
}


async function getPostDetail(postId, env) {
  const sql = `SELECT p.*, u.nickname, u.profile_img, u.trust_score, u.trade_count
    FROM pd_posts p LEFT JOIN pd_users u ON p.user_id = u.id
    WHERE p.id = ? AND p.is_deleted = 0`;
  const row = await env.DB.prepare(sql).bind(postId).first();
  if (!row) return json({ error: 'not_found' }, 404);
  return json(publicPost(row));
}


async function incrementView(postId, env) {
  await env.DB.prepare('UPDATE pd_posts SET view_count = view_count + 1 WHERE id = ?')
    .bind(postId).run();
  return json({ ok: true });
}


// ========================================
// 찜 (Like)
// ========================================

// v21 내가 쓴 글 (최근 200개)
async function getMyPosts(userId, env) {
  const { results } = await env.DB.prepare(
    `SELECT p.*, u.nickname, u.profile_img, u.trust_score
     FROM pd_posts p LEFT JOIN pd_users u ON p.user_id = u.id
     WHERE p.is_deleted = 0 AND p.user_id = ?
     ORDER BY p.created_at DESC LIMIT 200`
  ).bind(userId).all();
  return json({ posts: (results || []).map(publicPost) });
}

// v21 내가 찜한 글 (최근 200개)
async function getMyLikes(userId, env) {
  const { results } = await env.DB.prepare(
    `SELECT p.*, u.nickname, u.profile_img, u.trust_score
     FROM pd_likes l JOIN pd_posts p ON l.post_id = p.id
     LEFT JOIN pd_users u ON p.user_id = u.id
     WHERE l.user_id = ? AND p.is_deleted = 0
     ORDER BY p.created_at DESC LIMIT 200`
  ).bind(userId).all();
  return json({ posts: (results || []).map(publicPost) });
}

async function toggleLike(postId, userId, env) {
  const existing = await env.DB.prepare(
    'SELECT 1 FROM pd_likes WHERE user_id = ? AND post_id = ?'
  ).bind(userId, postId).first();

  if (existing) {
    await env.DB.prepare('DELETE FROM pd_likes WHERE user_id = ? AND post_id = ?')
      .bind(userId, postId).run();
    await env.DB.prepare('UPDATE pd_posts SET like_count = MAX(0, like_count - 1) WHERE id = ?')
      .bind(postId).run();
    return json({ liked: false });
  } else {
    await env.DB.prepare('INSERT INTO pd_likes (user_id, post_id) VALUES (?, ?)')
      .bind(userId, postId).run();
    await env.DB.prepare('UPDATE pd_posts SET like_count = like_count + 1 WHERE id = ?')
      .bind(postId).run();
    return json({ liked: true });
  }
}


// ========================================
// 가격 제안 (Offer)
// ========================================

async function createOffer(postId, buyerId, request, env) {
  const data = await request.json();
  const post = await env.DB.prepare('SELECT user_id FROM pd_posts WHERE id = ?')
    .bind(postId).first();
  if (!post) return json({ error: 'not_found' }, 404);

  await env.DB.prepare(
    `INSERT INTO pd_offers (post_id, buyer_id, seller_id, price, currency, status)
     VALUES (?,?,?,?,?,0)`
  ).bind(postId, buyerId, post.user_id, data.price || '', data.currency || 'KRW').run();

  // 판매자에게 알림
  await env.DB.prepare(
    `INSERT INTO pd_notifications (user_id, type, title, body, link)
     VALUES (?, 2, '가격 제안', ?, ?)`
  ).bind(post.user_id, `${data.price} ${data.currency || 'KRW'}`, `/post/${postId}`).run();

  return json({ ok: true });
}


// ========================================
// 채팅 (Chat)
// ========================================

async function getChatRooms(userId, env) {
  const sql = `SELECT r.*,
    CASE WHEN r.user1 = ? THEN r.user2 ELSE r.user1 END AS other_id,
    CASE WHEN r.user1 = ? THEN r.unread_1 ELSE r.unread_2 END AS unread
    FROM pd_chat_rooms r
    WHERE r.user1 = ? OR r.user2 = ?
    ORDER BY r.last_time DESC LIMIT 50`;

  const { results } = await env.DB.prepare(sql)
    .bind(userId, userId, userId, userId).all();

  // 상대 닉네임·프로필 이미지 조회
  const rooms = [];
  for (const r of results || []) {
    const other = await env.DB.prepare('SELECT nickname, profile_img FROM pd_users WHERE id = ?')
      .bind(r.other_id).first();
    rooms.push({
      id: r.id,
      other_name: other?.nickname || '사용자',
      other_img: other?.profile_img || '',
      last_msg: r.last_msg,
      last_time: r.last_time,
      unread: r.unread || 0
    });
  }
  return json({ rooms });
}


async function createChatRoom(userId, request, env) {
  const data = await request.json();
  const otherUser = data.other_user;
  const postId = data.post_id || null;
  const msg = data.msg || '';

  if (!otherUser) return json({ error: 'other_user required' }, 400);

  // 이미 존재하는 채팅방 확인 (같은 게시글)
  let room = null;
  if (postId) {
    room = await env.DB.prepare(
      `SELECT * FROM pd_chat_rooms
       WHERE post_id = ? AND ((user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?))`
    ).bind(postId, userId, otherUser, otherUser, userId).first();
  }

  let roomId;
  if (room) {
    roomId = room.id;
  } else {
    roomId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO pd_chat_rooms (id, user1, user2, post_id, last_msg, last_time)
       VALUES (?,?,?,?,?,datetime('now'))`
    ).bind(roomId, userId, otherUser, postId, msg).run();
  }

  // 메시지 저장
  if (msg) {
    await env.DB.prepare(
      `INSERT INTO pd_chat_msgs (room_id, sender, msg) VALUES (?,?,?)`
    ).bind(roomId, userId, msg).run();
    await env.DB.prepare(
      `UPDATE pd_chat_rooms SET last_msg = ?, last_time = datetime('now'),
       unread_2 = CASE WHEN user1 = ? THEN unread_2 + 1 ELSE unread_2 END,
       unread_1 = CASE WHEN user2 = ? THEN unread_1 + 1 ELSE unread_1 END
       WHERE id = ?`
    ).bind(msg, userId, userId, roomId).run();
    // 채팅수 증가
    if (postId) {
      await env.DB.prepare('UPDATE pd_posts SET chat_count = chat_count + 1 WHERE id = ?')
        .bind(postId).run();
    }
  }

  return json({ ok: true, room_id: roomId });
}


async function getChatMessages(roomId, userId, env) {
  // 읽음 처리
  const room = await env.DB.prepare('SELECT * FROM pd_chat_rooms WHERE id = ?')
    .bind(roomId).first();
  if (room) {
    if (room.user1 === userId) {
      await env.DB.prepare('UPDATE pd_chat_rooms SET unread_1 = 0 WHERE id = ?').bind(roomId).run();
    } else if (room.user2 === userId) {
      await env.DB.prepare('UPDATE pd_chat_rooms SET unread_2 = 0 WHERE id = ?').bind(roomId).run();
    }
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM pd_chat_msgs WHERE room_id = ? ORDER BY created_at ASC LIMIT 200'
  ).bind(roomId).all();

  return json({ messages: results || [] });
}


async function sendChatMessage(roomId, userId, request, env) {
  const data = await request.json();
  const msg = data.msg || '';
  if (!msg) return json({ error: 'msg required' }, 400);

  await env.DB.prepare(
    'INSERT INTO pd_chat_msgs (room_id, sender, msg) VALUES (?,?,?)'
  ).bind(roomId, userId, msg).run();

  // 채팅방 업데이트
  await env.DB.prepare(
    `UPDATE pd_chat_rooms SET last_msg = ?, last_time = datetime('now'),
     unread_1 = CASE WHEN user2 = ? THEN unread_1 + 1 ELSE unread_1 END,
     unread_2 = CASE WHEN user1 = ? THEN unread_2 + 1 ELSE unread_2 END
     WHERE id = ?`
  ).bind(msg, userId, userId, roomId).run();

  return json({ ok: true, room_id: roomId });
}


// ========================================
// 검색 (Search)
// ========================================

async function searchPosts(url, env) {
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const nation = url.searchParams.get('nation') || '';
  if (!q.trim()) return json({ posts: [] });

  // v24: 띄어쓰기와 상관없이 찾음 ("작업에어호수" → "작업 에어 호수")
  const qn = q.replace(/\s+/g, '');
  let where = "p.is_deleted = 0 AND (REPLACE(p.search_text, ' ', '') LIKE ? OR REPLACE(LOWER(p.title), ' ', '') LIKE ?)";
  let params = [`%${qn}%`, `%${qn}%`];

  if (nation) {
    where += ' AND p.nation_code = ?';
    params.push(nation);
  }

  const sql = `SELECT p.*, u.nickname, u.profile_img, u.trust_score
    FROM pd_posts p LEFT JOIN pd_users u ON p.user_id = u.id
    WHERE ${where} ORDER BY p.created_at DESC LIMIT 30`;

  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json({ posts: (results || []).map(publicPost) });
}


// ========================================
// 사용자 프로필 (User)
// ========================================

async function getMyProfile(userId, env) {
  const user = await env.DB.prepare('SELECT * FROM pd_users WHERE id = ?')
    .bind(userId).first();
  if (!user) return json({ error: 'not_found' }, 404);

  // 게시글 수
  const postCount = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM pd_posts WHERE user_id = ? AND is_deleted = 0'
  ).bind(userId).first();

  return json({
    ...user,
    post_count: postCount?.cnt || 0
  });
}


async function updateProfile(userId, request, env) {
  const data = await request.json();
  const fields = [];
  const params = [];

  /* v20 프로필 수정: 닉네임 1~20자, 사진은 https 주소(또는 빈 값 = 기본 사진)만 */
  if (data.nickname !== undefined) {
    const nick = String(data.nickname || '').replace(/[\u0000-\u001f<>]/g, '').trim();
    if (nick.length < 1 || nick.length > 20) return json({ error: 'nickname_length', message: '닉네임은 1~20자로 적어 주세요' }, 400);
    fields.push('nickname = ?'); params.push(nick);
  }
  if (data.profile_img !== undefined) {
    const img = String(data.profile_img || '').trim();
    if (img && !/^https:\/\/[^\s"'<>]{4,500}$/.test(img)) return json({ error: 'bad_image' }, 400);
    fields.push('profile_img = ?'); params.push(img);
  }
  if (data.nation_code !== undefined) { fields.push('nation_code = ?'); params.push(data.nation_code); }
  if (data.lang_code !== undefined) { fields.push('lang_code = ?'); params.push(data.lang_code); }
  // lat·lng·radius 는 받지 않는다 — 이용자 위치는 서버에 저장하지 않음 (위치기반서비스 신고 내용)

  if (fields.length === 0) return json({ error: 'no fields' }, 400);

  params.push(userId);
  await env.DB.prepare(`UPDATE pd_users SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...params).run();

  const user = await env.DB.prepare('SELECT * FROM pd_users WHERE id = ?').bind(userId).first();
  return json({ ok: true, user });
}


// ========================================
// v25 pododa 전용 계정 (coverfo 계정과 분리)
//  · 구글 로그인: 화면의 구글 단추가 준 ID 토큰을 구글 공개키로 직접 검증 (GOOGLE_CLIENT_ID 필요)
//  · 이메일 로그인: 6자리 인증 코드를 메일로 보냄 (RESEND_API_KEY · MAIL_FROM 필요)
//  · 같은 이메일로 이미 가입한 회원이면 그 계정(글·채팅)을 그대로 이어서 씀
//  · 로그인 표(pd_token)는 지금처럼 pododa 가 직접 만든다 (30일, 쓰는 동안 자동 연장)
// ========================================
const ADMIN_DEFAULT = 'hasin7jk@gmail.com';
const enc = (s) => new TextEncoder().encode(s);
function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function b64urlJson(s) { return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))); }
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function normEmail(e) { return String(e || '').trim().toLowerCase(); }
function validEmail(e) { return /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i.test(e); }
function adminEmails(env) {
  return String(env.ADMIN_EMAILS || ADMIN_DEFAULT).split(',').map(normEmail).filter(Boolean);
}
async function userEmail(userId, env) {
  const u = await env.DB.prepare('SELECT email FROM pd_users WHERE id = ?').bind(userId).first();
  return normEmail(u && u.email);
}
async function isAdmin(userId, env) {
  const e = await userEmail(userId, env);
  return !!e && adminEmails(env).includes(e);
}
function creditWon(env) { const n = parseInt(env.CREDIT_WON || '100', 10); return n > 0 ? n : 100; }

let authTablesReady = false;
async function ensureAuthTables(env) {
  if (authTablesReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pd_auth_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL)`).run();
  authTablesReady = true;
}

// GET /api/auth/config — 화면이 어떤 로그인 단추를 보여 줄지
function authConfig(env) {
  return json({
    google_client_id: env.GOOGLE_CLIENT_ID || '',
    email_login: !!(env.RESEND_API_KEY && env.MAIL_FROM),
    credit_won: creditWon(env),
  });
}

// 이메일로 기존 회원을 찾거나 새로 만든 뒤 pododa 로그인 표를 준다
async function loginByEmail(email, profile, data, env) {
  let user = await env.DB.prepare('SELECT * FROM pd_users WHERE LOWER(email) = ? LIMIT 1').bind(email).first();
  if (!user) {
    const id = 'pd_' + crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO pd_users (id, email, nickname, profile_img, nation_code, lang_code) VALUES (?,?,?,?,?,?)`
    ).bind(
      id, email,
      String(profile.name || email.split('@')[0] || '사용자').replace(/[\u0000-\u001f<>]/g, '').slice(0, 20) || '사용자',
      /^https:\/\//.test(profile.picture || '') ? profile.picture : '',
      String(data.nation_code || 'KR').slice(0, 4),
      String(data.lang_code || 'ko').slice(0, 8)
    ).run();
    user = await env.DB.prepare('SELECT * FROM pd_users WHERE id = ?').bind(id).first();
  }
  const token = await makeToken(user.id, env);
  return json({ ok: true, token, user });
}

// 구글 공개키 (1시간 기억)
let gKeys = null, gKeysAt = 0;
async function googleKeys() {
  if (gKeys && Date.now() - gKeysAt < 3600000) return gKeys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('google_keys ' + r.status);
  gKeys = (await r.json()).keys || [];
  gKeysAt = Date.now();
  return gKeys;
}
async function verifyGoogleIdToken(idToken, clientId) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return null;
  const header = b64urlJson(parts[0]);
  const p = b64urlJson(parts[1]);
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) { gKeys = null; jwk = (await googleKeys()).find((k) => k.kid === header.kid); }
  if (!jwk || header.alg !== 'RS256') return null;
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc(parts[0] + '.' + parts[1]));
  if (!ok) return null;
  if (p.iss !== 'accounts.google.com' && p.iss !== 'https://accounts.google.com') return null;
  if (p.aud !== clientId) return null;
  if (!p.exp || p.exp * 1000 < Date.now()) return null;
  if (!p.email || !(p.email_verified === true || p.email_verified === 'true')) return null;
  return p;
}

// POST /api/auth/google { credential }
async function authGoogle(request, env) {
  if (!env.GOOGLE_CLIENT_ID) return json({ error: 'google_off', message: '구글 로그인이 아직 설정되지 않았어요' }, 503);
  const data = await request.json().catch(() => ({}));
  const p = await verifyGoogleIdToken(data.credential, env.GOOGLE_CLIENT_ID);
  if (!p) return json({ error: 'invalid_google', message: '구글 로그인 확인에 실패했어요. 다시 시도해 주세요' }, 401);
  return loginByEmail(normEmail(p.email), { name: p.name, picture: p.picture }, data, env);
}

// POST /api/auth/email/start { email } — 인증 코드 메일 보내기
async function authEmailStart(request, env) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return json({ error: 'email_off', message: '이메일 로그인이 아직 설정되지 않았어요' }, 503);
  const data = await request.json().catch(() => ({}));
  const email = normEmail(data.email);
  if (!validEmail(email)) return json({ error: 'bad_email', message: '이메일 주소를 확인해 주세요' }, 400);
  await ensureAuthTables(env);
  const now = Date.now();
  const prev = await env.DB.prepare('SELECT sent_at FROM pd_auth_codes WHERE email = ?').bind(email).first();
  if (prev && now - prev.sent_at < 60000) return json({ error: 'too_soon', message: '1분 뒤에 다시 받을 수 있어요' }, 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const hash = await sha256hex(email + ':' + code + ':' + (env.JWT_SECRET || ''));
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      subject: `pododa 로그인 코드 ${code}`,
      text: `pododa 로그인 코드: ${code}\n\n10분 안에 pododa 로그인 화면에 입력해 주세요.\n직접 요청하지 않았다면 이 메일은 무시하셔도 됩니다.`,
      html: `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px"><div style="font-size:24px;font-weight:800;color:#7C3AED">pododa</div><p>로그인 코드예요. 10분 안에 입력해 주세요.</p><div style="font-size:34px;font-weight:800;letter-spacing:8px;padding:14px 0">${code}</div><p style="color:#888;font-size:13px">직접 요청하지 않았다면 이 메일은 무시하셔도 됩니다.</p></div>`,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return json({ error: 'send_failed', message: '메일을 보내지 못했어요 (' + r.status + ') ' + t.slice(0, 120) }, 502);
  }
  await env.DB.prepare(
    `INSERT INTO pd_auth_codes (email, code_hash, expires_at, tries, sent_at) VALUES (?,?,?,0,?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0, sent_at = excluded.sent_at`
  ).bind(email, hash, now + 10 * 60000, now).run();
  return json({ ok: true });
}

// POST /api/auth/email/verify { email, code }
async function authEmailVerify(request, env) {
  const data = await request.json().catch(() => ({}));
  const email = normEmail(data.email);
  const code = String(data.code || '').replace(/\D/g, '');
  if (!validEmail(email) || code.length !== 6) return json({ error: 'bad_code', message: '6자리 코드를 확인해 주세요' }, 400);
  await ensureAuthTables(env);
  const row = await env.DB.prepare('SELECT * FROM pd_auth_codes WHERE email = ?').bind(email).first();
  if (!row || row.expires_at < Date.now()) return json({ error: 'expired', message: '코드가 만료됐어요. 다시 받아 주세요' }, 400);
  if (row.tries >= 5) return json({ error: 'too_many', message: '5번 틀렸어요. 코드를 다시 받아 주세요' }, 429);
  const hash = await sha256hex(email + ':' + code + ':' + (env.JWT_SECRET || ''));
  if (hash !== row.code_hash) {
    await env.DB.prepare('UPDATE pd_auth_codes SET tries = tries + 1 WHERE email = ?').bind(email).run();
    return json({ error: 'wrong_code', message: '코드가 맞지 않아요 (' + (4 - row.tries) + '번 남음)' }, 400);
  }
  await env.DB.prepare('DELETE FROM pd_auth_codes WHERE email = ?').bind(email).run();
  return loginByEmail(email, {}, data, env);
}

// POST /api/auth/refresh — 로그인 표 연장 (쓰는 동안 로그아웃되지 않게)
async function authRefresh(userId, env) {
  const user = await env.DB.prepare('SELECT * FROM pd_users WHERE id = ?').bind(userId).first();
  if (!user) return json({ error: 'no_user' }, 401);
  return json({ ok: true, token: await makeToken(userId, env), user });
}


// ========================================
// v25 pododa 크레딧 (coverfo·포도톡 크레딧과 별개)
//  · free(무료: 이벤트·지급분, 환불 없음) · paid(유료: 대가를 받고 지급한 분, 환불 신청 가능)
//  · 지금은 관리자 지급만 (결제 연결은 나중에)
//  · 환불: 회원이 계좌를 적어 신청 → 유료 잔액이 '환불 대기'로 빠짐 → 관리자가 송금 후 '완료' (반려하면 되돌림)
// ========================================
let creditTablesReady = false;
async function ensureCreditTables(env) {
  if (creditTablesReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pd_credit_wallet (
      user_id TEXT PRIMARY KEY,
      free REAL NOT NULL DEFAULT 0,
      paid REAL NOT NULL DEFAULT 0,
      updated_at TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pd_credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      free_delta REAL NOT NULL DEFAULT 0,
      paid_delta REAL NOT NULL DEFAULT 0,
      free_after REAL NOT NULL DEFAULT 0,
      paid_after REAL NOT NULL DEFAULT 0,
      memo TEXT DEFAULT '',
      by_admin TEXT DEFAULT '',
      created_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS pd_credit_ledger_user ON pd_credit_ledger (user_id, id)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pd_credit_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email TEXT DEFAULT '',
      credits REAL NOT NULL,
      won INTEGER NOT NULL,
      bank TEXT DEFAULT '',
      account_no TEXT DEFAULT '',
      holder TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'requested',
      reason TEXT DEFAULT '',
      admin_memo TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      done_at TEXT)`),
  ]);
  creditTablesReady = true;
}

async function getWallet(userId, env) {
  await ensureCreditTables(env);
  const w = await env.DB.prepare('SELECT free, paid FROM pd_credit_wallet WHERE user_id = ?').bind(userId).first();
  return { free: w ? Number(w.free) : 0, paid: w ? Number(w.paid) : 0 };
}

// 잔액 바꾸기 + 내역 남기기. 잔액이 0 아래로 내려가면 바꾸지 않고 false
async function changeCredits(env, userId, freeDelta, paidDelta, kind, memo, byAdmin) {
  await ensureCreditTables(env);
  freeDelta = Math.round(Number(freeDelta || 0) * 10) / 10;
  paidDelta = Math.round(Number(paidDelta || 0) * 10) / 10;
  await env.DB.prepare(`INSERT OR IGNORE INTO pd_credit_wallet (user_id, free, paid, updated_at) VALUES (?, 0, 0, datetime('now'))`).bind(userId).run();
  const r = await env.DB.prepare(
    `UPDATE pd_credit_wallet SET free = free + ?, paid = paid + ?, updated_at = datetime('now')
     WHERE user_id = ? AND free + ? >= 0 AND paid + ? >= 0`
  ).bind(freeDelta, paidDelta, userId, freeDelta, paidDelta).run();
  if (!r.meta || !r.meta.changes) return false;
  await env.DB.prepare(
    `INSERT INTO pd_credit_ledger (user_id, kind, free_delta, paid_delta, free_after, paid_after, memo, by_admin, created_at)
     SELECT ?, ?, ?, ?, free, paid, ?, ?, datetime('now') FROM pd_credit_wallet WHERE user_id = ?`
  ).bind(userId, kind, freeDelta, paidDelta, String(memo || '').slice(0, 200), byAdmin || '', userId).run();
  return true;
}

// GET /api/credits — 내 크레딧 · 내역 · 환불 신청
async function myCredits(userId, env) {
  const w = await getWallet(userId, env);
  const { results: history } = await env.DB.prepare(
    'SELECT kind, free_delta, paid_delta, free_after, paid_after, memo, created_at FROM pd_credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50'
  ).bind(userId).all();
  const { results: refunds } = await env.DB.prepare(
    `SELECT id, credits, won, bank, holder, status, admin_memo, created_at, done_at FROM pd_credit_refunds WHERE user_id = ? ORDER BY id DESC LIMIT 10`
  ).bind(userId).all();
  return json({ ok: true, free: w.free, paid: w.paid, total: Math.round((w.free + w.paid) * 10) / 10,
    credit_won: creditWon(env), history: history || [], refunds: refunds || [], is_admin: await isAdmin(userId, env) });
}

function readAccount(a) {
  a = a || {};
  const acc = {
    bank: String(a.bank || '').trim().slice(0, 30),
    account_no: String(a.account_no || a.accountNumber || '').replace(/[^\d-]/g, '').slice(0, 30),
    holder: String(a.holder || a.holderName || '').trim().slice(0, 30),
  };
  return acc.bank && acc.account_no.replace(/\D/g, '').length >= 6 && acc.holder ? acc : null;
}

// 남은 유료 크레딧 전부를 환불 신청으로 돌림 (잔액에서 빠지고 '환불 대기')
async function requestRefund(userId, account, reason, env) {
  const w = await getWallet(userId, env);
  if (!(w.paid > 0)) return { error: 'no_paid', message: '환불할 유료 크레딧이 없어요' };
  if (reason !== 'withdraw') {
    const pending = await env.DB.prepare(`SELECT id FROM pd_credit_refunds WHERE user_id = ? AND status = 'requested' LIMIT 1`).bind(userId).first();
    if (pending) return { error: 'pending', message: '이미 처리 중인 환불 신청이 있어요' };
  }
  const ok = await changeCredits(env, userId, 0, -w.paid, 'refund_request', '환불 신청', '');
  if (!ok) return { error: 'changed', message: '잔액이 바뀌었어요. 다시 시도해 주세요' };
  const won = Math.round(w.paid * creditWon(env));
  const r = await env.DB.prepare(
    `INSERT INTO pd_credit_refunds (user_id, email, credits, won, bank, account_no, holder, status, reason, created_at)
     VALUES (?,?,?,?,?,?,?, 'requested', ?, datetime('now'))`
  ).bind(userId, await userEmail(userId, env), w.paid, won, account.bank, account.account_no, account.holder, reason || '').run();
  return { ok: true, id: r.meta && r.meta.last_row_id, credits: w.paid, won };
}

// POST /api/credits/refund { account:{bank, account_no, holder} }
async function refundRequest(userId, request, env) {
  const data = await request.json().catch(() => ({}));
  const account = readAccount(data.account);
  if (!account) return json({ error: 'account', message: '은행, 계좌번호, 예금주를 모두 적어 주세요' }, 400);
  const r = await requestRefund(userId, account, 'request', env);
  return json(r, r.ok ? 200 : 400);
}

// ----- 관리자 -----
// GET /api/admin/credits?q=이메일 — 회원 찾기 + 잔액 + 내역, 그리고 환불 신청 목록
async function adminCredits(url, env) {
  await ensureCreditTables(env);
  const q = normEmail(url.searchParams.get('q'));
  let found = null;
  if (q) {
    const u = await env.DB.prepare('SELECT id, email, nickname FROM pd_users WHERE LOWER(email) = ? LIMIT 1').bind(q).first();
    if (u) {
      const w = await getWallet(u.id, env);
      const { results } = await env.DB.prepare(
        'SELECT kind, free_delta, paid_delta, free_after, paid_after, memo, by_admin, created_at FROM pd_credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 30'
      ).bind(u.id).all();
      found = { user: u, free: w.free, paid: w.paid, history: results || [] };
    }
  }
  const { results: refunds } = await env.DB.prepare(
    `SELECT * FROM pd_credit_refunds ORDER BY CASE status WHEN 'requested' THEN 0 ELSE 1 END, id DESC LIMIT 30`
  ).all();
  return json({ ok: true, q, found, refunds: refunds || [], credit_won: creditWon(env) });
}

// POST /api/admin/credits/grant { email, kind:'free'|'paid', amount, memo } — amount 가 음수면 차감
async function adminGrant(adminId, request, env) {
  const data = await request.json().catch(() => ({}));
  const email = normEmail(data.email);
  const amount = Math.round(Number(data.amount) * 10) / 10;
  const kind = data.kind === 'paid' ? 'paid' : 'free';
  if (!isFinite(amount) || amount === 0 || Math.abs(amount) > 1000000) return json({ error: 'amount', message: '수량을 확인해 주세요' }, 400);
  const u = await env.DB.prepare('SELECT id FROM pd_users WHERE LOWER(email) = ? LIMIT 1').bind(email).first();
  if (!u) return json({ error: 'no_user', message: '그 이메일로 가입한 회원이 없어요' }, 404);
  const ok = await changeCredits(env, u.id, kind === 'free' ? amount : 0, kind === 'paid' ? amount : 0,
    amount > 0 ? 'grant_' + kind : 'deduct_' + kind, data.memo || '', await userEmail(adminId, env));
  if (!ok) return json({ error: 'balance', message: '잔액보다 많이 뺄 수 없어요' }, 400);
  return json({ ok: true, ...(await getWallet(u.id, env)) });
}

// POST /api/admin/refunds/:id { action:'done'|'reject', memo }
async function adminRefund(adminId, id, request, env) {
  await ensureCreditTables(env);
  const data = await request.json().catch(() => ({}));
  const r = await env.DB.prepare('SELECT * FROM pd_credit_refunds WHERE id = ?').bind(id).first();
  if (!r) return json({ error: 'not_found' }, 404);
  if (r.status !== 'requested') return json({ error: 'done_already', message: '이미 처리한 신청이에요' }, 400);
  const memo = String(data.memo || '').slice(0, 200);
  if (data.action === 'reject') {
    const exists = await env.DB.prepare('SELECT id FROM pd_users WHERE id = ?').bind(r.user_id).first();
    if (exists) await changeCredits(env, r.user_id, 0, r.credits, 'refund_reject', '환불 반려' + (memo ? ' · ' + memo : ''), await userEmail(adminId, env));
    await env.DB.prepare(`UPDATE pd_credit_refunds SET status = 'rejected', admin_memo = ?, done_at = datetime('now') WHERE id = ?`).bind(memo, id).run();
  } else if (data.action === 'done') {
    // 송금을 마쳤으면 계좌번호는 뒷자리 4개만 남김
    const masked = '****' + String(r.account_no || '').replace(/\D/g, '').slice(-4);
    await env.DB.prepare(`UPDATE pd_credit_refunds SET status = 'done', admin_memo = ?, account_no = ?, done_at = datetime('now') WHERE id = ?`).bind(memo, masked, id).run();
  } else return json({ error: 'action' }, 400);
  return json({ ok: true });
}


// ========================================
// v25 회원 탈퇴 (pododa 계정만 — coverfo 와 상관없음)
//  · 무료 크레딧은 없어지고, 남은 유료 크레딧은 적어 준 계좌로 환불 신청이 함께 접수된다
// ========================================
// POST /api/me/withdraw-plan
async function withdrawPlan(userId, env) {
  const w = await getWallet(userId, env);
  const pending = await env.DB.prepare(`SELECT COUNT(*) AS n FROM pd_credit_refunds WHERE user_id = ? AND status = 'requested'`).bind(userId).first();
  return json({ ok: true, plan: { free: w.free, paid: w.paid, won: Math.round(w.paid * creditWon(env)), credit_won: creditWon(env), pending: (pending && pending.n) || 0 } });
}

async function deletePrefix(env, prefix) {
  let cursor;
  do {
    const l = await env.MEDIA.list({ prefix, cursor });
    if (l.objects.length) await env.MEDIA.delete(l.objects.map((o) => o.key));
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
}

async function deletePododaData(userId, env) {
  const u = String(userId);
  const email = await userEmail(u, env);
  const run = async (sql, ...b) => { try { await env.DB.prepare(sql).bind(...b).run(); } catch (e) { /* 없는 표는 건너뜀 */ } };
  try { await deletePrefix(env, `posts/${u}/`); } catch (e) {}
  try { await deletePrefix(env, `uploads/${u}/`); } catch (e) {}
  await run('DELETE FROM pd_likes WHERE user_id = ? OR post_id IN (SELECT id FROM pd_posts WHERE user_id = ?)', u, u);
  await run('DELETE FROM pd_offers WHERE buyer_id = ? OR seller_id = ? OR post_id IN (SELECT id FROM pd_posts WHERE user_id = ?)', u, u, u);
  await run('DELETE FROM pd_notifications WHERE user_id = ?', u);
  await run('DELETE FROM pd_chat_msgs WHERE room_id IN (SELECT id FROM pd_chat_rooms WHERE user1 = ? OR user2 = ?)', u, u);
  await run('DELETE FROM pd_chat_rooms WHERE user1 = ? OR user2 = ?', u, u);
  await run('DELETE FROM pd_posts WHERE user_id = ?', u);
  await run('DELETE FROM pd_location_log WHERE user_id = ?', u);
  await run('DELETE FROM pd_credit_ledger WHERE user_id = ?', u);
  await run('DELETE FROM pd_credit_wallet WHERE user_id = ?', u);
  if (email) await run('DELETE FROM pd_auth_codes WHERE email = ?', email);
  /* 신고 기록은 처리 완료 후 1년, 환불 신청 기록은 처리를 위해 개인정보 처리방침의 기간 동안 보관 */
  await env.DB.prepare('DELETE FROM pd_users WHERE id = ?').bind(u).run();
}

// POST /api/me/withdraw { confirm:'탈퇴', account? }
async function withdraw(userId, request, env) {
  const data = await request.json().catch(() => ({}));
  if (String(data.confirm || '') !== '탈퇴') return json({ error: 'confirm', message: '확인 문구 "탈퇴" 를 적어 주세요' }, 400);
  const w = await getWallet(userId, env);
  let refund = null;
  if (w.paid > 0) {
    const account = readAccount(data.account);
    if (!account) return json({ error: 'account', message: '남은 유료 크레딧을 돌려받을 계좌를 모두 적어 주세요' }, 400);
    const r = await requestRefund(userId, account, 'withdraw', env);
    if (!r.ok) return json(r, 400);
    refund = { credits: r.credits, won: r.won };
  }
  await deletePododaData(userId, env);
  return json({ ok: true, refund });
}


// ========================================
// 이미지 업로드 (R2)
// ========================================

async function uploadImage(request, userId, env) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) return json({ error: 'file required' }, 400);

  const ext = file.name.split('.').pop() || 'jpg';
  const filename = `uploads/${userId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;

  await env.MEDIA.put(filename, file.stream(), {
    httpMetadata: { contentType: file.type }
  });

  return json({ ok: true, url: `${new URL(request.url).origin}/media/${filename}` });
}

// R2 에 저장된 사진을 내보냄 (posts/·uploads/ 폴더만 허용)
async function serveMedia(key, request, env) {
  if (!key || key.includes('..') || !(key.startsWith('posts/') || key.startsWith('uploads/'))) {
    return new Response('Not Found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  const obj = await env.MEDIA.get(key);
  if (!obj) {
    return new Response('Not Found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
}


// ========================================
// 알림 (Notifications)
// ========================================

async function getNotifications(userId, env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM pd_notifications WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 50`
  ).bind(userId).all();

  // 읽음 처리
  await env.DB.prepare(
    'UPDATE pd_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
  ).bind(userId).run();

  return json({ notifications: results || [] });
}


// ========================================
// 신고 (Report)
// ========================================

async function createReport(userId, request, env) {
  const data = await request.json();
  await env.DB.prepare(
    `INSERT INTO pd_reports (reporter, target_type, target_id, reason)
     VALUES (?,?,?,?)`
  ).bind(userId, data.target_type || 'post', data.target_id || '', data.reason || '').run();
  return json({ ok: true });
}


// ========================================
// 토큰 생성 / 검증 (간이 JWT)
// ========================================

async function makeToken(userId, env) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub: userId, exp: Date.now() + 30 * 24 * 3600000 }));
  const secret = env.JWT_SECRET || 'pododa-default-secret-change-me';
  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}

async function verifyToken(token, env) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp && payload.exp < Date.now()) return null;

    const secret = env.JWT_SECRET || 'pododa-default-secret-change-me';
    const data = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    return valid ? payload.sub : null;
  } catch {
    return null;
  }
}


// ========================================
// 위치정보 (내주변 거리 검색 · 이용사실 기록)
// ========================================

// 시장(0)·상점(1)·배달(2)·내주변(3) + 위도·경도 + 반경(0 초과)이 모두 있을 때만 거리 검색 (자연(4)은 거리 없음)
function nearbyParams(url, cat) {
  const c = parseInt(cat);
  if (!(c >= 0 && c <= 3)) return null;
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const r = parseFloat(url.searchParams.get('r') || '0');
  if (!isFinite(lat) || !isFinite(lng) || !isFinite(r) || r <= 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const dev = url.searchParams.get('dev') || '';
  return { lat, lng, r: Math.min(r, 50), dev: /^[A-Za-z0-9-]{8,64}$/.test(dev) ? dev : '' };
}

function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function roundLoc(v, max) {
  const n = parseFloat(v);
  if (!isFinite(n) || Math.abs(n) > max) return 0;
  return Math.round(n * 100) / 100;
}

// 글 정보에서 좌표(lat·lng)를 빼고 내보낸다
function publicPost(p) {
  if (!p) return p;
  const { lat, lng, ...rest } = p;
  return rest;
}

// 위치정보 이용·제공사실 확인자료 (위치정보법 취급대장) — 6개월 이상 보관
let locLogReady = false;
async function logLocationUse(env, who, request, service, providedTo) {
  try {
    if (!locLogReady) {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pd_location_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        service TEXT NOT NULL,
        provided_to TEXT DEFAULT '',
        used_at TEXT NOT NULL)`).run();
      locLogReady = true;
    }
    // 보관기간 1년이 지난 기록 파기 (약관 제5조) — 가끔(약 2%) 한 번씩
    if (Math.random() < 0.02) {
      await env.DB.prepare(`DELETE FROM pd_location_log WHERE used_at < datetime('now', '-1 year')`).run();
    }
    const ua = (request && request.headers.get('User-Agent')) || '';
    const os = /iPhone|iPad|iPod|Macintosh/i.test(ua) ? 'apple' : /Android/i.test(ua) ? 'android' : 'other';
    await env.DB.prepare(
      `INSERT INTO pd_location_log (user_id, source, service, provided_to, used_at) VALUES (?,?,?,?,datetime('now'))`
    ).bind(String(who || 'anon'), 'browser_geolocation_' + os, service, providedTo || '').run();
  } catch (e) { /* 기록 실패가 화면을 막지 않게 */ }
}


// 동의 철회 시 본인 기록 파기: 로그인했으면 계정 ID, 그리고 이 기기의 무작위 ID 기록
async function deleteLocationLog(url, userId, env) {
  const dev = url.searchParams.get('dev') || '';
  const ids = [];
  if (userId) ids.push(String(userId));
  if (/^[A-Za-z0-9-]{8,64}$/.test(dev)) ids.push('dev:' + dev);
  if (!ids.length) return json({ error: 'no_id' }, 400);
  try {
    const r = await env.DB.prepare(
      `DELETE FROM pd_location_log WHERE user_id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).run();
    return json({ ok: true, deleted: r.meta?.changes || 0 });
  } catch (e) {
    if (/no such table/i.test(e.message || '')) return json({ ok: true, deleted: 0 });
    throw e;
  }
}


// ========================================
// 유틸
// ========================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

function cors(response) {
  const newRes = new Response(response.body, response);
  newRes.headers.set('Access-Control-Allow-Origin', '*');
  newRes.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  newRes.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return newRes;
}