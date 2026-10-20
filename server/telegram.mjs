const MINUTE = 60000, DAY = 86400000;
const SERVICES = Object.freeze({ gas: 'Газ', water: 'Вода', electricity: 'Електроенергія', delivery: 'Доставка газу', trash: 'Вивіз сміття' });
const SITE = 'https://komunalochka.com';
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const q = (db, sql, args = []) => db.prepare(sql).bind(...args);
const rows = async (db, sql, args) => (await q(db, sql, args).all()).results;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff' } });
class Fault extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new Fault(status, message); };
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');
async function secretEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 256 || b.length < 32) return false;
  const x = await digest(a), y = await digest(b); let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
async function cronSignature(secret, timestamp) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode('telegram-tick:' + timestamp));
  return [...new Uint8Array(signature)].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function kyivParts(timestamp) {
  return Object.fromEntries(fmt.formatToParts(new Date(timestamp)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
export function kyivInstant(year, month, day, time) {
  const [hour, minute] = time.split(':').map(Number), wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set([-12, 0, 12].map(delta => {
    const stamp = wall + delta * 3600000, p = kyivParts(stamp);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - stamp;
  }));
  const candidates = [...offsets].map(offset => wall - offset).sort((a, b) => a - b);
  const wallOf = stamp => { const p = kyivParts(stamp); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); };
  return candidates.find(stamp => wallOf(stamp) === wall) ?? candidates.filter(stamp => wallOf(stamp) >= wall).sort((a, b) => wallOf(a) - wallOf(b))[0];
}
export function nextDue(day, time, after) {
  const p = kyivParts(after);
  for (let offset = 0; offset < 3; offset++) {
    const date = new Date(Date.UTC(p.year, p.month - 1 + offset, 1));
    const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const stamp = kyivInstant(year, month, Math.min(day, lastDay), time);
    if (stamp > after) return stamp;
  }
  throw new Error('Unable to calculate next reminder');
}
const periodOf = timestamp => { const p = kyivParts(timestamp); return `${p.year}-${String(p.month).padStart(2, '0')}`; };
export function validateReminder(body) {
  if (!Object.hasOwn(SERVICES, body.service) || !['payment', 'readings'].includes(body.kind) || (body.kind === 'readings' && !['gas','water','electricity'].includes(body.service))) fail(400, 'Оберіть послугу й тип нагадування.');
  if (!Number.isInteger(body.day) || body.day < 1 || body.day > 31 || typeof body.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) fail(400, 'Оберіть день від 1 до 31 і час у форматі ГГ:ХХ.');
  return { service: body.service, kind: body.kind, day: body.day, time: body.time };
}
async function bodyJSON(request, context, webhook = false) {
  if (!webhook) {
    const allowed = (context.env.PREMIUM_ALLOWED_ORIGINS || new URL(request.url).origin).split(',').map(s => s.trim());
    if (!allowed.includes(request.headers.get('Origin')) || request.headers.get('X-Komunalochka-Request') !== '1') fail(403, 'Запит має походити з цього сайту.');
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') fail(415, 'Потрібен JSON-запит.');
  const reader = request.body?.getReader(); if (!reader) fail(400, 'Заповніть форму.');
  const chunks = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > (webhook ? 65536 : 4096)) { await reader.cancel(); fail(413, 'Запит завеликий.'); } chunks.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(400, 'Некоректний JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') fail(400, 'Заповніть форму.'); return value;
}
async function rateLimit(context, now) {
  const start = Math.floor(now / (15 * MINUTE)) * 15 * MINUTE;
  const result = await q(context.db, `INSERT INTO premium_limits(key,window_start,attempts) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,attempts=CASE WHEN premium_limits.window_start=excluded.window_start THEN premium_limits.attempts+1 ELSE 1 END RETURNING attempts`, ['telegram:' + context.user.userId, start]).first();
  if (result.attempts > 40) fail(429, 'Забагато змін. Зачекайте кілька хвилин.');
}
async function telegram(context, method, body) {
  try {
    // Workers' deployed runtime accepts manual/follow, not redirect:error.
    // Never follow a redirect that could expose the bot token to another host.
    const response = await (context.fetcher || fetch)(`https://api.telegram.org/bot${context.env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (response.status >= 300 && response.status < 400) { const error = new Fault(502, 'Telegram тимчасово недоступний.'); error.telegramCode = response.status; throw error; }
    const data = await response.json();
    if (!data.ok) { const error = new Fault(502, 'Telegram тимчасово недоступний.'); error.telegramCode = data.error_code; error.retryAfter = data.parameters?.retry_after; throw error; }
    return data.result;
  } catch (error) {
    console.warn(JSON.stringify({ event: 'telegram_transport_failed', method, code: Number.isInteger(error.telegramCode) ? error.telegramCode : null, uncertain: !(error instanceof Fault) }));
    if (error instanceof Fault) throw error; const safe = new Fault(502, 'Не вдалося зв’язатися з Telegram.'); safe.uncertain = true; throw safe;
  }
}
const configured = env => Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_CRON_SECRET && /^[A-Za-z0-9_]{5,32}$/.test(env.TELEGRAM_BOT_USERNAME || ''));
async function status(context, now) {
  const { db, user, env } = context;
  const base = { configured: configured(env), schedulerReady: env.TELEGRAM_SCHEDULER_ENABLED === 'true', botUsername: env.TELEGRAM_BOT_USERNAME || 'KomunalOchka_bot', authenticated: Boolean(user?.userId), serverTime: now };
  if (!user?.userId) return base;
  const binding = await q(db, 'SELECT name,connected_at AS connectedAt FROM telegram_bindings WHERE user_id=?', [user.userId]).first();
  const pending = await q(db, 'SELECT name,expires_at AS expiresAt FROM telegram_links WHERE user_id=? AND chat_id IS NOT NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1', [user.userId, now]).first();
  const reminders = await rows(db, `SELECT r.id,r.service,r.kind,r.day,r.time,r.enabled,r.next_due AS nextDue,
    EXISTS(SELECT 1 FROM telegram_completed c WHERE c.reminder_id=r.id AND c.period=?) AS completed
    FROM telegram_reminders r WHERE r.user_id=? AND r.deleted=0 ORDER BY r.created_at,r.id`, [periodOf(now), user.userId]);
  return { ...base, binding: binding || null, pending: pending || null, reminders };
}
async function unlinkChat(db, chatId) {
  await db.batch([
    q(db, `UPDATE telegram_reminders SET enabled=0 WHERE user_id IN(SELECT user_id FROM telegram_bindings WHERE chat_id=?)`, [chatId]),
    q(db, 'DELETE FROM telegram_bindings WHERE chat_id=?', [chatId]),
    q(db, 'DELETE FROM telegram_links WHERE chat_id=?', [chatId]),
    q(db, `UPDATE telegram_deliveries SET status='cancelled',next_at=NULL WHERE chat_id=? AND status='pending'`, [chatId]),
  ]);
}
async function complete(db, reminderId, period, now) {
  await db.batch([
    q(db, 'INSERT OR IGNORE INTO telegram_completed(reminder_id,period,completed_at) VALUES(?,?,?)', [reminderId, period, now]),
    q(db, `UPDATE telegram_deliveries SET status='completed',next_at=NULL WHERE reminder_id=? AND period=?`, [reminderId, period]),
  ]);
}
async function webhook(request, context, now) {
  if (!await secretEquals(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), context.env.TELEGRAM_WEBHOOK_SECRET)) fail(403, 'Недозволений запит.');
  const update = await bodyJSON(request, context, true), { db } = context;
  if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) fail(400, 'Некоректне оновлення.');
  const claim = await q(db, 'INSERT OR IGNORE INTO telegram_updates(id,created_at) VALUES(?,?)', [update.update_id, now]).run();
  if (!claim.meta.changes) return { ok: true };
  context.claimedUpdateId = update.update_id;
  const membership = update.my_chat_member;
  if (membership?.chat?.type === 'private' && ['kicked','left'].includes(membership.new_chat_member?.status)) { await unlinkChat(db, String(membership.chat.id)); return { ok: true }; }
  const message = update.message;
  if (message?.chat?.type === 'private' && Number.isSafeInteger(message.chat.id) && message.chat.id > 0 && message.from?.id === message.chat.id && !message.from?.is_bot) {
    const chatId = String(message.chat.id), text = String(message.text || '').trim();
    if (/^\/stop(?:@\w+)?$/.test(text)) {
      await unlinkChat(db, chatId); await telegram(context, 'sendMessage', { chat_id: chatId, text: 'Нагадування вимкнено. Підключити Telegram знову можна на komunalochka.com.' }); return { ok: true };
    }
    const start = text.match(/^\/start(?:@\w+)? ([a-f0-9]{64})$/);
    if (start) {
      const name = message.from.username ? '@' + message.from.username : String(message.from.first_name || 'Ваш Telegram').slice(0, 80);
      const result = await q(db, 'UPDATE telegram_links SET chat_id=?,name=? WHERE hash=? AND expires_at>? AND (chat_id IS NULL OR chat_id=?) RETURNING user_id', [chatId, name, await digest(start[1]), now, chatId]).first();
      await telegram(context, 'sendMessage', { chat_id: chatId, text: result ? 'Майже готово! Поверніться на сайт і підтвердьте «Це мій Telegram».' : 'Посилання застаріло. Відкрийте «Нагадування» на сайті й натисніть «Підключити Telegram» ще раз.', reply_markup: { inline_keyboard: [[{ text: 'Відкрити КомуналОчку', url: SITE + '/#reminders' }]] } });
    } else if (/^\/(?:start|help)(?:@\w+)?$/.test(text)) {
      await telegram(context, 'sendMessage', { chat_id: chatId, text: 'Вітаю у КомуналОчці! Підключіть Telegram до свого акаунта на сайті й оберіть, коли нагадувати про оплату або показники. Команда /stop вимикає нагадування.', reply_markup: { inline_keyboard: [[{ text: 'Налаштувати нагадування', url: SITE + '/#reminders' }]] } });
    }
  }
  const cb = update.callback_query, chat = cb?.message?.chat;
  if (chat?.type === 'private' && cb.from?.id === chat.id && Number.isSafeInteger(chat.id)) {
    const match = String(cb.data || '').match(/^(done|later):([a-f0-9-]{36})$/); let text = 'Це нагадування вже неактивне.';
    const item = match && await q(db, `SELECT d.*,r.time,r.enabled,r.deleted,r.kind FROM telegram_deliveries d JOIN telegram_reminders r ON r.id=d.reminder_id
      JOIN telegram_bindings b ON b.user_id=r.user_id AND b.chat_id=d.chat_id WHERE d.id=? AND d.chat_id=?`, [match[2], String(chat.id)]).first();
    if (item && !item.deleted && item.enabled) {
      if (match[1] === 'done') { await complete(db, item.reminder_id, item.period, now); text = item.kind === 'payment' ? 'Позначено вами як оплачене.' : 'Позначено вами як передане.'; }
      else if (item.status === 'sent' && cb.message.message_id === item.message_id && !await q(db, 'SELECT 1 FROM telegram_completed WHERE reminder_id=? AND period=?', [item.reminder_id, item.period]).first()) {
        const p = kyivParts(now), nextDay = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
        const due = kyivInstant(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), item.time);
        await q(db, `UPDATE telegram_deliveries SET status='pending',next_at=?,lease_until=0,attempts=0 WHERE id=? AND status='sent'`, [due, item.id]).run(); text = 'Нагадаю завтра у вибраний вами час.';
      }
    }
    await telegram(context, 'answerCallbackQuery', { callback_query_id: cb.id, text });
  }
  return { ok: true };
}
export async function deliverDue(context, now) {
  const started = Date.now();
  const { db } = context;
  await q(db, `INSERT OR IGNORE INTO telegram_leases(name,lease_until) VALUES('tick',0)`).run();
  if (!await q(db, `UPDATE telegram_leases SET lease_until=? WHERE name='tick' AND lease_until<? RETURNING name`, [now + 120000, now]).first()) return { ok: true, busy: true, sent: 0 };
  let sent = 0, failed = 0;
  try {
    const due = await rows(db, `SELECT r.*,b.chat_id FROM telegram_reminders r JOIN telegram_bindings b ON b.user_id=r.user_id WHERE r.enabled=1 AND r.deleted=0 AND r.next_due<=? ORDER BY r.next_due LIMIT 40`, [now]);
    for (const r of due) {
      const period = periodOf(r.next_due), next = nextDue(r.day, r.time, now);
      const statements = [];
      if (r.next_due >= now - 7 * DAY) statements.push(q(db, `INSERT OR IGNORE INTO telegram_deliveries(id,reminder_id,period,chat_id,status,next_at,created_at)
        SELECT ?,?,?,?,'pending',?,? WHERE NOT EXISTS(SELECT 1 FROM telegram_completed WHERE reminder_id=? AND period=?)`, [crypto.randomUUID(), r.id, period, r.chat_id, now, now, r.id, period]));
      statements.push(q(db, 'UPDATE telegram_reminders SET next_due=? WHERE id=? AND next_due=?', [next, r.id, r.next_due])); await db.batch(statements);
    }
    const queue = await rows(db, `SELECT d.id FROM telegram_deliveries d JOIN telegram_reminders r ON r.id=d.reminder_id JOIN telegram_bindings b ON b.user_id=r.user_id AND b.chat_id=d.chat_id
      WHERE d.status='pending' AND d.next_at<=? AND d.lease_until<? AND r.enabled=1 AND r.deleted=0
      AND NOT EXISTS(SELECT 1 FROM telegram_completed c WHERE c.reminder_id=d.reminder_id AND c.period=d.period) ORDER BY d.next_at LIMIT 40`, [now, now]);
    for (const item of queue) {
      if (Date.now() - started > 20000) break;
      const delivery = await q(db, `UPDATE telegram_deliveries SET lease_until=?,attempts=attempts+1 WHERE id=? AND status='pending' AND lease_until<? RETURNING *`, [now + 60000, item.id, now]).first();
      if (!delivery) continue;
      const reminder = await q(db, 'SELECT service,kind FROM telegram_reminders WHERE id=? AND enabled=1 AND deleted=0', [delivery.reminder_id]).first();
      if (!reminder) continue;
      try {
        const text = reminder.kind === 'payment' ? `Час оплатити послугу «${SERVICES[reminder.service]}». Після оплати натисніть «Я оплатив».` : `Час передати показники: ${SERVICES[reminder.service]}. Відкрийте КомуналОчку, щоб підготувати дані.`;
        const result = await telegram(context, 'sendMessage', { chat_id: delivery.chat_id, text, reply_markup: { inline_keyboard: [
          [{ text: 'Відкрити КомуналОчку', url: SITE + '/#' + (reminder.kind === 'payment' ? 'dashboard' : 'transfer') }],
          [{ text: reminder.kind === 'payment' ? 'Я оплатив' : 'Показники передано', callback_data: 'done:' + delivery.id }, { text: 'Нагадати завтра', callback_data: 'later:' + delivery.id }],
        ] } });
        await q(db, `UPDATE telegram_deliveries SET status=CASE WHEN status='pending' THEN 'sent' ELSE status END,message_id=?,sent_at=?,lease_until=0,next_at=NULL WHERE id=?`, [result.message_id, now, delivery.id]).run(); sent++;
      } catch (error) {
        failed++;
        if (error.telegramCode === 403) await unlinkChat(db, delivery.chat_id);
        const retry = !error.uncertain && error.telegramCode !== 403 && delivery.attempts < 5;
        const delay = Math.min(3600, Math.max(60, Number(error.retryAfter) || 60 * 2 ** delivery.attempts));
        await q(db, `UPDATE telegram_deliveries SET status=?,next_at=?,lease_until=0 WHERE id=? AND status='pending'`, [retry ? 'pending' : 'failed', retry ? now + delay * 1000 : null, delivery.id]).run();
      }
    }
    await q(db, 'DELETE FROM telegram_links WHERE expires_at<?', [now - DAY]).run();
    await q(db, 'DELETE FROM telegram_updates WHERE created_at<?', [now - 14 * DAY]).run();
    return { ok: true, sent, failed };
  } finally { await q(db, `UPDATE telegram_leases SET lease_until=0 WHERE name='tick' AND lease_until=?`, [now + 120000]).run(); }
}
export async function handleTelegramRequest(request, context) {
  const now = context.now ? context.now() : Date.now(), { db, user, env = {} } = context;
  context.env = env;
  try {
    if (!db) fail(503, 'Нагадування тимчасово недоступні.');
    const path = new URL(request.url).pathname.replace(/^\/api\/telegram/, '');
    if (path === '/webhook' && request.method === 'POST') {
      if (!configured(env)) fail(503, 'Бот ще налаштовується.');
      // The state changes are idempotent. Do not endlessly retry a reply if Telegram is unavailable.
      try { return json(await webhook(request, context, now)); } catch (error) {
        if (error.telegramCode || error.uncertain) return json({ ok: true });
        if (context.claimedUpdateId !== undefined) await q(db, 'DELETE FROM telegram_updates WHERE id=?', [context.claimedUpdateId]).run();
        throw error;
      }
    }
    if (path === '/tick' && request.method === 'POST') {
      const timestamp = request.headers.get('X-Komunalochka-Timestamp') || '';
      if (!/^\d{10,11}$/.test(timestamp) || Math.abs(Number(timestamp) * 1000 - now) > 120000 || typeof env.TELEGRAM_CRON_SECRET !== 'string' || env.TELEGRAM_CRON_SECRET.length < 32) fail(403, 'Недозволений запит.');
      if (!await secretEquals(request.headers.get('X-Komunalochka-Cron'), await cronSignature(env.TELEGRAM_CRON_SECRET, timestamp))) fail(403, 'Недозволений запит.');
      if (!configured(env)) fail(503, 'Бот ще налаштовується.');
      return json(await deliverDue(context, now));
    }
    if (path === '/status' && request.method === 'GET') return json(await status(context, now));
    if (!user?.userId) fail(401, 'Увійдіть за поштою, щоб налаштувати нагадування.');
    if (request.method !== 'POST') fail(405, 'Метод не підтримується.');
    const body = await bodyJSON(request, context); await rateLimit(context, now);
    if (!configured(env)) fail(503, 'Бот ще налаштовується. Спробуйте пізніше.');
    if (path === '/link') {
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join('');
      await db.batch([q(db, 'DELETE FROM telegram_links WHERE user_id=?', [user.userId]), q(db, 'INSERT INTO telegram_links(hash,user_id,created_at,expires_at) VALUES(?,?,?,?)', [await digest(token), user.userId, now, now + 10 * MINUTE])]);
      return json({ url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${token}`, expiresAt: now + 10 * MINUTE });
    }
    if (path === '/confirm') {
      const pending = await q(db, 'SELECT hash,chat_id,name FROM telegram_links WHERE user_id=? AND chat_id IS NOT NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1', [user.userId, now]).first();
      if (!pending) fail(409, 'Спочатку натисніть «Почати» у боті. Посилання діє 10 хвилин.');
      const other = await q(db, 'SELECT user_id FROM telegram_bindings WHERE chat_id=? AND user_id<>?', [pending.chat_id, user.userId]).first();
      if (other) fail(409, 'Цей Telegram уже підключений до іншого акаунта. Спочатку від’єднайте його там або надішліть боту /stop.');
      await db.batch([
        q(db, `INSERT INTO telegram_bindings(user_id,chat_id,name,connected_at) SELECT user_id,chat_id,name,? FROM telegram_links WHERE hash=? AND expires_at>?
          ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,name=excluded.name,connected_at=excluded.connected_at`, [now, pending.hash, now]),
        q(db, 'DELETE FROM telegram_links WHERE user_id=?', [user.userId]),
      ]);
      return json(await status(context, now));
    }
    if (path === '/disconnect') {
      const binding = await q(db, 'SELECT chat_id FROM telegram_bindings WHERE user_id=?', [user.userId]).first();
      if (binding) await unlinkChat(db, binding.chat_id);
      await q(db, 'DELETE FROM telegram_links WHERE user_id=?', [user.userId]).run(); return json(await status(context, now));
    }
    const ownBinding = await q(db, 'SELECT chat_id FROM telegram_bindings WHERE user_id=?', [user.userId]).first();
    if (!ownBinding) fail(409, 'Спочатку підключіть Telegram.');
    if (path === '/test') {
      const windowStart = Math.floor(now / MINUTE) * MINUTE;
      const limit = await q(db, `INSERT INTO premium_limits(key,window_start,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,attempts=CASE WHEN premium_limits.window_start=excluded.window_start THEN premium_limits.attempts+1 ELSE 1 END RETURNING attempts`, ['telegram-test:' + user.userId, windowStart]).first();
      if (limit.attempts > 1) fail(429, 'Тестове повідомлення можна надіслати раз на хвилину.');
      await telegram(context, 'sendMessage', { chat_id: ownBinding.chat_id, text: 'Усе працює! Це перевірка підключення КомуналОчки. Нагадування про оплату й показники надходитимуть у вибрані вами дні.', reply_markup: { inline_keyboard: [[{ text: 'Мої нагадування', url: SITE + '/#reminders' }]] } });
      return json(await status(context, now));
    }
    if (path === '/reminders') {
      const value = validateReminder(body);
      const result = await q(db, `INSERT INTO telegram_reminders(id,user_id,service,kind,day,time,next_due,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM telegram_reminders WHERE user_id=? AND deleted=0)<20`, [crypto.randomUUID(), user.userId, value.service, value.kind, value.day, value.time, nextDue(value.day, value.time, now), now, now, user.userId]).run();
      if (!result.meta.changes) fail(409, 'Можна зберегти до 20 нагадувань. Приберіть зайві.');
      return json(await status(context, now), 201);
    }
    const match = path.match(/^\/reminders\/([a-f0-9-]{36})$/);
    if (match) {
      const reminder = await q(db, 'SELECT * FROM telegram_reminders WHERE id=? AND user_id=? AND deleted=0', [match[1], user.userId]).first();
      if (!reminder) fail(404, 'Нагадування не знайдено.');
      if (body.action === 'done') await complete(db, reminder.id, periodOf(now), now);
      else if (['enable','pause','remove'].includes(body.action)) await db.batch([
        q(db, 'UPDATE telegram_reminders SET enabled=?,deleted=?,next_due=?,updated_at=? WHERE id=? AND user_id=?', [body.action === 'enable' ? 1 : 0, body.action === 'remove' ? 1 : 0, nextDue(reminder.day, reminder.time, now), now, reminder.id, user.userId]),
        q(db, `UPDATE telegram_deliveries SET status='cancelled',next_at=NULL WHERE reminder_id=? AND status='pending'`, [reminder.id]),
      ]);
      else fail(400, 'Невідома дія.');
      return json(await status(context, now));
    }
    fail(404, 'Сторінку не знайдено.');
  } catch (error) { return json({ error: error instanceof Fault ? error.message : 'Не вдалося завершити дію. Спробуйте ще раз.' }, error instanceof Fault ? error.status : 500); }
}
