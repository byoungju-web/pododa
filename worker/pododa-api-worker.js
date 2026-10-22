// ============================================
// pododa.kr 글로벌 커머스 플랫폼 - API Worker
// Cloudflare Worker + D1 + R2
// ============================================
// 바인딩 필요:
//   DB   → D1 pododa-db
//   MEDIA → R2 pododa-media
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
      // v20 회원 탈퇴: 환불 계획 미리보기 · 탈퇴 실행
      if (path === '/api/me/withdraw-plan' && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await withdrawPlan(userId, request, env));
      }
      if (path === '/api/me/withdraw' && method === 'POST') {
        if (!userId) return cors(json({ error: 'login_required' }, 401));
        return cors(await withdraw(userId, request, env));
      }

      // ===== 인증 콜백 =====
      if (path === '/api/auth/callback' && method === 'POST') {
        return cors(await authCallback(request, env));
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
// v20 회원 탈퇴 (크레딧 환불 포함)
//  · scope 'pododa' : pododa 정보만 지움 (coverfo 계정·크레딧은 그대로 — coverfo·포도톡에서 계속 사용)
//  · scope 'all'    : coverfo 계정까지 탈퇴. coverfo 서버(/api/account-delete)가 남은 충전 크레딧을
//                     토스 결제 취소로 환불한 뒤 계정을 지운다. 환불이 하나라도 실패하면 아무것도 지우지 않는다.
//  · 화면은 coverfo 로그인 토큰(sb_token)을 함께 보낸다 — pododa 계정과 같은 사람인지 확인한 뒤에만 coverfo 에 넘김
// ========================================
async function sbUserId(token, env) {
  if (!token) return '';
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON || '' } });
    if (!r.ok) return '';
    const u = await r.json();
    return u && u.id ? String(u.id) : '';
  } catch { return ''; }
}

async function coverfoAccount(token, body, env) {
  const base = (env.COVERFO_URL || 'https://coverfo.com').replace(/\/+$/, '');
  const r = await fetch(`${base}/api/account-delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function withdrawPlan(userId, request, env) {
  const data = await request.json().catch(() => ({}));
  const token = String(data.sb_token || '');
  if ((await sbUserId(token, env)) !== String(userId)) return json({ error: 'relogin', message: '보안을 위해 다시 로그인해 주세요' }, 401);
  const { status, j } = await coverfoAccount(token, { op: 'plan' }, env);
  if (status !== 200) return json({ error: 'plan_failed', message: j.error || j.message || ('coverfo ' + status) }, 502);
  return json({ ok: true, plan: j.data || j });
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
  /* 신고 기록은 개인정보 처리방침에 따라 처리 완료 후 1년 보관 */
  await env.DB.prepare('DELETE FROM pd_users WHERE id = ?').bind(u).run();
}

async function withdraw(userId, request, env) {
  const data = await request.json().catch(() => ({}));
  if (String(data.confirm || '') !== '탈퇴') return json({ error: 'confirm', message: '확인 문구 "탈퇴" 를 적어 주세요' }, 400);
  const scope = data.scope === 'all' ? 'all' : 'pododa';
  let refund = null;
  if (scope === 'all') {
    const token = String(data.sb_token || '');
    if ((await sbUserId(token, env)) !== String(userId)) return json({ error: 'relogin', message: '보안을 위해 다시 로그인해 주세요' }, 401);
    const { status, j } = await coverfoAccount(token, { op: 'delete', confirm: '탈퇴', refund: data.refund !== false, account: data.account || undefined }, env);
    const d = j.data || j;
    if (status !== 200 || !d || d.ok === false) {
      /* 환불 실패 등 — pododa 정보도 지우지 않고 멈춘다 */
      return json({ error: 'coverfo_failed', message: (d && d.error) || j.error || ('coverfo ' + status), refund: d && d.refund }, 502);
    }
    refund = d.refund || null;
  }
  await deletePododaData(userId, env);
  return json({ ok: true, scope, refund });
}


// ========================================
// 인증 (Auth - coverfo Supabase 연동)
// ========================================

async function authCallback(request, env) {
  const data = await request.json();
  const supabaseToken = data.access_token;
  if (!supabaseToken) return json({ error: 'token required' }, 400);

  // coverfo Supabase에서 사용자 정보 가져오기
  // SUPABASE_URL 은 env에서 설정
  const supabaseUrl = env.SUPABASE_URL || 'https://your-project.supabase.co';
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${supabaseToken}`, 'apikey': env.SUPABASE_ANON || '' }
  });

  if (!res.ok) return json({ error: 'invalid token' }, 401);
  const supaUser = await res.json();

  // pd_users에 upsert
  const existing = await env.DB.prepare('SELECT * FROM pd_users WHERE id = ?')
    .bind(supaUser.id).first();

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO pd_users (id, email, nickname, profile_img, nation_code, lang_code)
       VALUES (?,?,?,?,?,?)`
    ).bind(
      supaUser.id,
      supaUser.email || '',
      supaUser.user_metadata?.nickname || supaUser.email?.split('@')[0] || '사용자',
      supaUser.user_metadata?.avatar_url || '',
      data.nation_code || 'KR',
      data.lang_code || 'ko'
    ).run();
  }

  // 자체 JWT 생성 (간단한 방식)
  const token = await makeToken(supaUser.id, env);
  const user = existing || await env.DB.prepare('SELECT * FROM pd_users WHERE id = ?')
    .bind(supaUser.id).first();

  return json({ ok: true, token, user });
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