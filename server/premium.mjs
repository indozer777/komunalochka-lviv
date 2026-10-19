const DAY = 86400000;
const CODE_PATTERN = /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/;
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
  'Vary': 'Cookie, Authorization, oai-authenticated-user-id', 'X-Content-Type-Options': 'nosniff',
} });
const query = (db, sql, args = []) => db.prepare(sql).bind(...args);
const all = async (db, sql, args) => (await query(db, sql, args).all()).results;
const clean = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : fail(400, 'Перевірте текстові поля.');
const integer = (value, min, max, label) => Number.isInteger(value) && value >= min && value <= max ? value : fail(400, `Перевірте поле «${label}».`);
const days = (value, label) => value === null ? null : integer(value, 1, 3650, label);
export const normalizePromoCode = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
export async function hashPromoCode(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizePromoCode(value)));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function generatePromoCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = [...crypto.getRandomValues(new Uint8Array(16))].map(n => alphabet[n % alphabet.length]).join('');
  return code.match(/.{4}/g).join('-');
}
const administrator = (user, email) => Boolean(user?.authProvider !== 'email' && user?.userId && user?.email && email && user.email.toLowerCase() === email.trim().toLowerCase());
function authorized(context) {
  if (!context.user?.userId || !context.user?.email) fail(401, 'Увійдіть через ChatGPT, щоб продовжити.');
  if (!context.db) fail(503, 'Сервіс Premium тимчасово недоступний. Розрахунки працюють як раніше.');
}
function adminOnly(context) {
  authorized(context);
  if (!administrator(context.user, context.adminEmail)) fail(403, 'Цей розділ доступний лише адміністратору.');
}
async function readBody(request, context) {
  const origin = request.headers.get('Origin');
  const allowed = context.allowedOrigins ? context.allowedOrigins.split(',').map(s => s.trim()).filter(Boolean) : [new URL(request.url).origin];
  if (!origin || !allowed.includes(origin) || request.headers.get('X-Komunalochka-Request') !== '1') fail(403, 'Запит має походити з цього сайту.');
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') fail(415, 'Потрібен JSON-запит.');
  if (Number(request.headers.get('Content-Length')) > 8192) fail(413, 'Запит завеликий.');
  const reader = request.body?.getReader(); if (!reader) fail(400, 'Заповніть форму.');
  const chunks = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > 8192) { await reader.cancel(); fail(413, 'Запит завеликий.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(400, 'Некоректний JSON-запит.'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'Заповніть форму.');
  return body;
}
async function rememberUser(db, user, now) {
  await query(db, `INSERT INTO premium_users (id,email,name,created_at,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,updated_at=excluded.updated_at`,
  [user.userId, user.email.slice(0, 254), (user.displayName || user.email).slice(0, 120), now, now]).run();
}
async function rateLimit(db, key, now, limit, period) {
  const start = Math.floor(now / period) * period;
  const result = await query(db, `INSERT INTO premium_limits (key,window_start,attempts) VALUES (?,?,1)
    ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,
      attempts=CASE WHEN premium_limits.window_start=excluded.window_start THEN premium_limits.attempts+1 ELSE 1 END
    RETURNING attempts`, [key, start]).first();
  if (result.attempts > limit) fail(429, 'Забагато спроб. Спробуйте пізніше.');
}
async function accessFor(db, userId, now) {
  const row = await query(db, 'SELECT * FROM premium_access WHERE user_id=?', [userId]).first();
  return { active: Boolean(row && !row.revoked && (row.expires_at === null || row.expires_at > now)),
    expiresAt: row?.expires_at ?? null, source: row?.source ?? null, revoked: Boolean(row?.revoked) };
}
async function session(context, now) {
  const { db, user } = context;
  const base = { authProvider: user ? (user.authProvider === 'email' ? 'email' : 'sites') : null, hasSiteSession: Boolean(context.hasSiteSession), signIn: context.signIn || '/signin-with-chatgpt?return_to=%2F%3Fpremium%3D1', signOut: context.signOut || '/signout-with-chatgpt?return_to=%2F', serverTime: now };
  if (!user?.userId || !user?.email) return { ...base, user: null, isAdmin: false, access: { active: false, expiresAt: null, source: null }, request: null };
  authorized(context);
  const isAdmin = administrator(user, context.adminEmail);
  const access = isAdmin ? { active: true, expiresAt: null, source: 'owner', revoked: false } : await accessFor(db, user.userId, now);
  const request = await query(db, `SELECT id,message,status,created_at AS createdAt,reviewed_at AS reviewedAt,note
    FROM premium_requests WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1`, [user.userId]).first();
  return { ...base, user: { id: user.userId, email: user.email, name: user.displayName || user.email }, isAdmin, access, request };
}
// All grant statements run inside the same D1 batch as their authorizing mutation.
const GRANT_SQL = `INSERT INTO premium_access (user_id,expires_at,revoked,source,updated_at,granted_by)
  SELECT user_id,expires_at,0,source,?,granted_by FROM (%SOURCE%) WHERE 1
  ON CONFLICT(user_id) DO UPDATE SET
    expires_at=CASE
      WHEN excluded.expires_at IS NULL THEN NULL
      WHEN premium_access.revoked=0 AND premium_access.expires_at IS NULL THEN NULL
      ELSE MAX(excluded.updated_at,CASE WHEN premium_access.revoked=0 THEN COALESCE(premium_access.expires_at,0) ELSE 0 END)
        + (excluded.expires_at-excluded.updated_at) END,
    revoked=0,source=excluded.source,updated_at=excluded.updated_at,granted_by=excluded.granted_by`;

async function redeem(context, body, now) {
  const { db, user } = context;
  await rateLimit(db, 'redeem:' + user.userId, now, 10, 15 * 60000);
  const code = normalizePromoCode(body.code);
  if (!CODE_PATTERN.test(code)) fail(400, 'Введіть промокод у форматі XXXX-XXXX-XXXX-XXXX.');
  const hash = await hashPromoCode(code);
  const promo = await query(db, 'SELECT id FROM premium_codes WHERE code_hash=?', [hash]).first();
  if (!promo) fail(400, 'Промокод недоступний: перевірте символи, строк дії та ліміт активацій.');
  if (await query(db, 'SELECT id FROM premium_redemptions WHERE code_id=? AND user_id=?', [promo.id, user.userId]).first()) {
    return { ...(await session(context, now)), message: 'Ви вже використали цей промокод. Повторно вводити його не потрібно.' };
  }
  await rememberUser(db, user, now);
  const id = crypto.randomUUID();
  const source = `SELECT r.user_id,
    CASE WHEN c.access_days IS NULL THEN NULL ELSE ?+c.access_days*${DAY} END AS expires_at,
    'promo' AS source,c.created_by AS granted_by
    FROM premium_redemptions r JOIN premium_codes c ON c.id=r.code_id WHERE r.id=?`;
  const results = await db.batch([
    query(db, `INSERT INTO premium_redemptions (id,code_id,user_id,redeemed_at)
      SELECT ?,id,?,? FROM premium_codes WHERE id=? AND enabled=1
      AND (expires_at IS NULL OR expires_at>?) AND used_count<max_uses
      AND NOT EXISTS(SELECT 1 FROM premium_redemptions WHERE code_id=? AND user_id=?)
      ON CONFLICT DO NOTHING`, [id, user.userId, now, promo.id, now, promo.id, user.userId]),
    query(db, `UPDATE premium_codes SET used_count=used_count+1 WHERE id=?
      AND EXISTS(SELECT 1 FROM premium_redemptions WHERE id=?)`, [promo.id, id]),
    query(db, GRANT_SQL.replace('%SOURCE%', source), [now, now, id]),
  ]);
  if (!results[0].meta.changes) fail(409, 'Промокод недоступний: строк дії або ліміт активацій вичерпано.');
  return { ...(await session(context, now)), message: 'Premium активовано для вашого акаунта.' };
}
async function submitRequest(context, body, now) {
  const { db, user } = context;
  if (administrator(user, context.adminEmail) || (await accessFor(db, user.userId, now)).active) fail(409, 'Premium уже активний.');
  const message = clean(body.message, 600);
  if (message.length < 10) fail(400, 'Напишіть коротке звернення: від 10 до 600 символів.');
  await rememberUser(db, user, now);
  const result = await query(db, `INSERT INTO premium_requests (id,user_id,message,status,created_at,note)
    SELECT ?,?,?,'pending',?,'' WHERE NOT EXISTS
    (SELECT 1 FROM premium_requests WHERE user_id=? AND (status='pending' OR created_at>?))
    ON CONFLICT DO NOTHING`, [crypto.randomUUID(), user.userId, message, now, user.userId, now - DAY]).run();
  if (!result.meta.changes) fail(429, 'Заявка вже очікує розгляду або минуло менше доби від попередньої.');
  return { ...(await session(context, now)), message: 'Заявку надіслано. Рішення з’явиться в цьому вікні після розгляду.' };
}
async function adminDashboard(context, now) {
  const { db } = context;
  const [requests, codes, access] = await Promise.all([
    all(db, `SELECT r.id,r.user_id AS userId,u.email,u.name,r.message,r.status,r.created_at AS createdAt,
      r.reviewed_at AS reviewedAt,r.note FROM premium_requests r JOIN premium_users u ON u.id=r.user_id
      ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 200`),
    all(db, `SELECT id,label,max_uses AS maxUses,used_count AS usedCount,expires_at AS expiresAt,
      access_days AS accessDays,enabled,created_at AS createdAt FROM premium_codes ORDER BY created_at DESC LIMIT 200`),
    all(db, `SELECT a.user_id AS userId,u.email,u.name,a.expires_at AS expiresAt,a.revoked,a.source,a.updated_at AS updatedAt
      FROM premium_access a JOIN premium_users u ON u.id=a.user_id ORDER BY a.updated_at DESC LIMIT 200`),
  ]);
  const counts = await query(db, `SELECT
    (SELECT COUNT(*) FROM premium_requests WHERE status='pending') AS pending,
    (SELECT COUNT(*) FROM premium_access WHERE revoked=0 AND (expires_at IS NULL OR expires_at>?)) AS active,
    (SELECT COUNT(*) FROM premium_codes WHERE enabled=1 AND used_count<max_uses AND (expires_at IS NULL OR expires_at>?)) AS codes`, [now, now]).first();
  return { requests, codes, access, counts, serverTime: now };
}
async function createCode(context, body, now) {
  const label = clean(body.label, 80); if (label.length < 2) fail(400, 'Вкажіть назву промокоду, від 2 символів.');
  const maxUses = integer(body.maxUses, 1, 10000, 'Ліміт активацій');
  const validityDays = days(body.validityDays, 'Строк активації'), accessDays = days(body.accessDays, 'Тривалість Premium');
  const code = generatePromoCode(), id = crypto.randomUUID();
  await query(context.db, `INSERT INTO premium_codes
    (id,code_hash,label,max_uses,used_count,expires_at,access_days,enabled,created_at,created_by)
    VALUES (?,?,?,?,0,?,?,1,?,?)`, [id, await hashPromoCode(code), label, maxUses, validityDays === null ? null : now + validityDays * DAY, accessDays, now, context.user.userId]).run();
  return { id, code, message: 'Збережіть промокод зараз. На сервері зберігається лише його хеш.' };
}
async function reviewRequest(context, id, body, now) {
  if (!['approved', 'declined'].includes(body.decision)) fail(400, 'Оберіть рішення за заявкою.');
  const note = clean(body.note ?? '', 400), accessDays = body.decision === 'approved' ? days(body.accessDays, 'Тривалість Premium') : null;
  const reviewId = crypto.randomUUID();
  const statements = [query(context.db, `UPDATE premium_requests SET status=?,reviewed_at=?,reviewed_by=?,review_id=?,note=?
    WHERE id=? AND status='pending'`, [body.decision, now, context.user.userId, reviewId, note, id])];
  if (body.decision === 'approved') {
    const source = `SELECT user_id,? AS expires_at,'request' AS source,? AS granted_by
      FROM premium_requests WHERE id=? AND review_id=? AND status='approved'`;
    statements.push(query(context.db, GRANT_SQL.replace('%SOURCE%', source), [now, accessDays === null ? null : now + accessDays * DAY, context.user.userId, id, reviewId]));
  }
  const result = await context.db.batch(statements);
  if (!result[0].meta.changes) fail(409, 'Заявку вже розглянуто або її не знайдено. Оновіть список.');
  return { message: body.decision === 'approved' ? 'Заявку схвалено. Premium активовано.' : 'Рішення збережено.' };
}
async function changeAccess(context, userId, body, now) {
  if (!await query(context.db, 'SELECT id FROM premium_users WHERE id=?', [userId]).first()) fail(404, 'Акаунт не знайдено.');
  if (body.action === 'revoke') {
    await query(context.db, 'UPDATE premium_access SET revoked=1,updated_at=?,granted_by=? WHERE user_id=?', [now, context.user.userId, userId]).run();
    return { message: 'Доступ відкликано.' };
  }
  if (body.action !== 'grant') fail(400, 'Оберіть дію з доступом.');
  const accessDays = days(body.accessDays, 'Тривалість Premium');
  const source = 'SELECT ? AS user_id,? AS expires_at,\'admin\' AS source,? AS granted_by';
  await query(context.db, GRANT_SQL.replace('%SOURCE%', source), [now, userId, accessDays === null ? null : now + accessDays * DAY, context.user.userId]).run();
  return { message: 'Доступ надано або продовжено.' };
}
export async function handlePremiumRequest(request, context) {
  try {
    const now = context.now?.() ?? Date.now();
    const path = new URL(request.url).pathname.replace(/\/$/, '');
    if (path === '/api/premium/session' && request.method === 'GET') return json(await session(context, now));
    if (path.startsWith('/api/premium/admin')) adminOnly(context); else authorized(context);
    if (path === '/api/premium/admin' && request.method === 'GET') return json(await adminDashboard(context, now));
    if (request.method !== 'POST') fail(405, 'Цей метод не підтримується.');
    const body = await readBody(request, context);
    if (path === '/api/premium/redeem') return json(await redeem(context, body, now));
    if (path === '/api/premium/requests') return json(await submitRequest(context, body, now));
    if (path === '/api/premium/admin/codes') return json(await createCode(context, body, now), 201);
    let match = path.match(/^\/api\/premium\/admin\/codes\/([a-zA-Z0-9-]{1,80})$/);
    if (match) {
      if (typeof body.enabled !== 'boolean') fail(400, 'Перевірте стан промокоду.');
      const result = await query(context.db, 'UPDATE premium_codes SET enabled=? WHERE id=?', [Number(body.enabled), match[1]]).run();
      if (!result.meta.changes) fail(404, 'Промокод не знайдено.');
      return json({ message: body.enabled ? 'Промокод увімкнено.' : 'Нові активації вимкнено. Раніше наданий доступ збережено.' });
    }
    match = path.match(/^\/api\/premium\/admin\/requests\/([a-zA-Z0-9-]{1,80})$/);
    if (match) return json(await reviewRequest(context, match[1], body, now));
    match = path.match(/^\/api\/premium\/admin\/access\/([^/]{1,200})$/);
    if (match) return json(await changeAccess(context, decodeURIComponent(match[1]), body, now));
    fail(404, 'Сторінку API не знайдено.');
  } catch (error) {
    if (!(error instanceof ApiError)) console.error('Premium API: internal operation failed');
    return json({ error: error instanceof ApiError ? error.message : 'Не вдалося завершити дію. Спробуйте ще раз пізніше.' }, error instanceof ApiError ? error.status : 500);
  }
}
