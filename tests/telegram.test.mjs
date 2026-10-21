import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { handleTelegramRequest, nextDue, kyivParts } from '../server/telegram.mjs';

const NOW = Date.parse('2026-10-20T05:00:00Z'), MINUTE = 60000, DAY = 86400000;
const user = id => ({ userId: id });
function setup() {
  const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  const db = { prepare(text) { let args = []; return { bind(...values) { args = values; return this; }, async first() { return sql.prepare(text).get(...args) || null; }, async all() { return { results: sql.prepare(text).all(...args) }; }, async run() { return this.execute(); }, execute() { const r = sql.prepare(text).run(...args); return { meta: { changes: Number(r.changes) }, success: true }; } }; }, async batch(statements) { sql.exec('BEGIN IMMEDIATE'); try { const r = statements.map(s => s.execute()); sql.exec('COMMIT'); return r; } catch(e) { sql.exec('ROLLBACK'); throw e; } } };
  const env = { TELEGRAM_BOT_TOKEN: 'unit-test-only', TELEGRAM_BOT_USERNAME: 'TestKomunal_bot', TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(64), TELEGRAM_CRON_SECRET: 'c'.repeat(64), TELEGRAM_SCHEDULER_ENABLED: 'true', PREMIUM_ALLOWED_ORIGINS: 'https://app.test' };
  let now = NOW, update = 0, message = 0, transport;
  const calls = [];
  const fetcher = async (url, options) => { assert.equal(options.redirect, 'manual'); const method = url.split('/').at(-1), body = JSON.parse(options.body); calls.push({ method, body }); if (transport) return transport(method, body); return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: ++message } : true }); };
  async function call(who, path, body, headers = {}) {
    const request = new Request('https://app.test/api/telegram' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'https://app.test', 'Content-Type': 'application/json', 'X-Komunalochka-Request': '1', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const response = await handleTelegramRequest(request, { db, user: who, env, now: () => now, fetcher });
    return { status: response.status, headers: response.headers, ...await response.json() };
  }
  const webhook = (body, headers = {}) => call(null, '/webhook', { update_id: ++update, ...body }, { 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET, ...headers });
  const start = (token, chat = 123) => webhook({ message: { chat: { type: 'private', id: chat }, from: { id: chat, first_name: 'Олена' }, text: '/start ' + token } });
  const tick = () => { const stamp = String(Math.floor(now / 1000)); return call(null, '/tick', {}, { 'X-Komunalochka-Timestamp': stamp, 'X-Komunalochka-Cron': createHmac('sha256', env.TELEGRAM_CRON_SECRET).update('telegram-tick:' + stamp).digest('hex') }); };
  async function bind(who = user('one'), chat = 123) { const link = await call(who, '/link', {}); assert.equal(link.status, 200); await start(new URL(link.url).searchParams.get('start'), chat); const result = await call(who, '/confirm', {}); assert.equal(result.status, 200); return who; }
  async function reminder(who, data = {}) { const result = await call(who, '/reminders', { service: 'gas', kind: 'payment', day: 20, time: '09:00', ...data }); assert.equal(result.status, 201, JSON.stringify(result)); return result.reminders.at(-1); }
  const callback = (id, action, chat = 123, message_id = 1) => webhook({ callback_query: { id: 'callback-' + update, from: { id: chat }, data: action + ':' + id, message: { message_id, chat: { type: 'private', id: chat } } } });
  return { sql, call, webhook, start, tick, bind, reminder, callback, env, calls, advance: ms => { now += ms; }, transport: fn => { transport = fn; } };
}

test('розклад використовує Київ, кінець місяця, високосний рік і переходи літнього часу', () => {
  assert.equal(nextDue(31, '09:00', Date.parse('2026-02-01T00:00Z')), Date.parse('2026-02-28T07:00Z'));
  assert.equal(nextDue(31, '09:00', Date.parse('2028-02-01T00:00Z')), Date.parse('2028-02-29T07:00Z'));
  assert.equal(nextDue(20, '09:00', Date.parse('2026-10-20T06:00Z')), Date.parse('2026-11-20T07:00Z'));
  const spring = kyivParts(nextDue(29, '03:30', Date.parse('2026-03-01T00:00Z')));
  assert.equal(spring.day, 29); assert.equal(spring.hour, 4); assert.equal(spring.minute, 30);
  assert.equal(nextDue(25, '03:30', Date.parse('2026-10-01T00:00Z')), Date.parse('2026-10-25T00:30Z'));
});
test('анонімний статус не містить даних; зміни, webhook і tick захищені окремо', async () => {
  const s = setup(); const publicStatus = await s.call(null, '/status');
  assert.equal(publicStatus.configured, true); assert.equal(publicStatus.authenticated, false); assert.equal(publicStatus.binding, undefined);
  assert.equal(publicStatus.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await s.call(null, '/link', {})).status, 401);
  assert.equal((await s.call(user('one'), '/link', {}, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await s.call(user('one'), '/link', {}, { 'X-Komunalochka-Request': '' })).status, 403);
  assert.equal((await s.call(null, '/tick', {})).status, 403);
  assert.equal((await s.webhook({}, { 'X-Telegram-Bot-Api-Secret-Token': 'incorrect' })).status, 403);
  assert.equal((await s.call(user('one'), '/link', '{bad')).status, 400);
  assert.equal((await s.call(user('one'), '/link', { data: 'x'.repeat(5000) })).status, 413);
});
test('cron приймає лише свіжий HMAC-підпис, а секрет не передається в заголовках', async () => {
  const s = setup(), stamp = String(Math.floor(NOW / 1000));
  const signature = createHmac('sha256', s.env.TELEGRAM_CRON_SECRET).update('telegram-tick:' + stamp).digest('hex');
  assert.notEqual(signature, s.env.TELEGRAM_CRON_SECRET);
  assert.equal((await s.call(null, '/tick', {}, { 'X-Komunalochka-Timestamp': stamp, 'X-Komunalochka-Cron': s.env.TELEGRAM_CRON_SECRET })).status, 403);
  assert.equal((await s.tick()).status, 200);
  s.advance(3 * MINUTE);
  assert.equal((await s.call(null, '/tick', {}, { 'X-Komunalochka-Timestamp': stamp, 'X-Komunalochka-Cron': signature })).status, 403);
  assert.equal((await s.tick()).status, 200);
});
test('одноразове посилання зберігається хешем, групи і чужий відправник не прив’язуються', async () => {
  const s = setup(), who = user('one'), link = await s.call(who, '/link', {}), token = new URL(link.url).searchParams.get('start');
  assert.match(token, /^[a-f0-9]{64}$/); assert(!JSON.stringify(s.sql.prepare('select * from telegram_links').get()).includes(token));
  await s.webhook({ message: { chat: { type: 'group', id: -1 }, from: { id: 123 }, text: '/start ' + token } });
  await s.webhook({ message: { chat: { type: 'private', id: 123 }, from: { id: 456 }, text: '/start ' + token } });
  assert.equal((await s.call(who, '/confirm', {})).status, 409);
  await s.start(token); const pending = await s.call(who, '/status'); assert.equal(pending.pending.name, 'Олена'); assert.equal(pending.binding, null);
  assert.equal((await s.call(user('other'), '/confirm', {})).status, 409);
  assert.equal((await s.call(who, '/confirm', {})).binding.name, 'Олена');
  assert.equal(s.sql.prepare('select count(*) n from telegram_links').get().n, 0);
  const own = await s.call(who, '/status'); assert(!JSON.stringify(own).includes('chat_id')); assert.equal((await s.call(user('other'), '/status')).binding, null);
});
test('прострочені й замінені посилання не працюють, Telegram не належить двом акаунтам', async () => {
  const s = setup(), who = user('one');
  const a = await s.call(who, '/link', {}), b = await s.call(who, '/link', {});
  await s.start(new URL(a.url).searchParams.get('start')); assert.equal((await s.call(who, '/status')).pending, null);
  s.advance(11 * MINUTE); await s.start(new URL(b.url).searchParams.get('start')); assert.equal((await s.call(who, '/confirm', {})).status, 409);
  await s.bind(who); const other = user('two'), link = await s.call(other, '/link', {}); await s.start(new URL(link.url).searchParams.get('start'));
  assert.equal((await s.call(other, '/confirm', {})).status, 409);
  assert.equal((await s.call(who, '/status')).binding.name, 'Олена');
});
test('нагадування валідовані та доступні лише власнику', async () => {
  const s = setup(), who = await s.bind(), other = await s.bind(user('two'), 456);
  for (const data of [{ day: 0 }, { day: 32 }, { day: 1.5 }, { time: '24:00' }, { service: '__proto__' }, { service: 'trash', kind: 'readings' }]) assert.equal((await s.call(who, '/reminders', { service: 'gas', kind: 'payment', day: 20, time: '09:00', ...data })).status, 400);
  const r = await s.reminder(who); assert.equal((await s.call(other, '/status')).reminders.length, 0);
  assert.equal((await s.call(other, '/reminders/' + r.id, { action: 'remove' })).status, 404);
  assert.equal((await s.call(who, '/reminders/' + r.id, { action: 'pause' })).reminders[0].enabled, 0);
  assert.equal((await s.call(who, '/reminders/' + r.id, { action: 'enable' })).reminders[0].enabled, 1);
  assert.equal((await s.call(who, '/reminders/' + r.id, { action: 'remove' })).reminders.length, 0);
});
test('tick надсилає один раз, паралельний tick і повторний webhook не дублюють повідомлення', async () => {
  const s = setup(), who = await s.bind(); await s.reminder(who); s.calls.length = 0; s.advance(60 * MINUTE);
  const ticks = await Promise.all([s.tick(), s.tick()]); assert.equal(ticks.reduce((n, r) => n + r.sent, 0), 1);
  assert.equal((await s.tick()).sent, 0); assert.equal(s.calls.filter(c => c.method === 'sendMessage').length, 1);
  const delivery = s.sql.prepare('select * from telegram_deliveries').get(); assert.equal(delivery.status, 'sent');
  const text = s.calls[0].body.text; assert.match(text, /Газ/); assert(!text.includes('one'));
  const repeat = { update_id: 9999, message: { chat: { type: 'private', id: 123 }, from: { id: 123 }, text: '/help' } };
  await s.call(null, '/webhook', repeat, { 'X-Telegram-Bot-Api-Secret-Token': s.env.TELEGRAM_WEBHOOK_SECRET });
  await s.call(null, '/webhook', repeat, { 'X-Telegram-Bot-Api-Secret-Token': s.env.TELEGRAM_WEBHOOK_SECRET });
  assert.equal(s.calls.filter(c => c.method === 'sendMessage').length, 2);
});
test('позначка оплати до розкладу пропускає надсилання; пауза і відключення також', async () => {
  const s = setup(), who = await s.bind(); const r = await s.reminder(who);
  await s.call(who, '/reminders/' + r.id, { action: 'done' }); s.advance(60 * MINUTE); assert.equal((await s.tick()).sent, 0);
  const second = await s.reminder(who, { service: 'water', time: '10:00' }); await s.call(who, '/reminders/' + second.id, { action: 'pause' });
  s.advance(60 * MINUTE); assert.equal((await s.tick()).sent, 0);
  await s.call(who, '/disconnect', {}); assert.equal((await s.call(who, '/status')).binding, null);
  assert.equal((await s.call(who, '/reminders', {})).status, 409);
});
test('відкладення до завтра та оплата захищені від чужого чату й повторного натискання', async () => {
  const s = setup(), who = await s.bind(); await s.reminder(who); s.advance(60 * MINUTE); await s.tick();
  let d = s.sql.prepare('select * from telegram_deliveries').get();
  await s.callback(d.id, 'later', 456, d.message_id); assert.equal(s.sql.prepare('select status from telegram_deliveries').get().status, 'sent');
  await s.callback(d.id, 'later', 123, d.message_id); const due = s.sql.prepare('select next_at from telegram_deliveries').get().next_at;
  assert.equal(due, NOW + 60 * MINUTE + DAY);
  await s.callback(d.id, 'later', 123, d.message_id); assert.equal(s.sql.prepare('select next_at from telegram_deliveries').get().next_at, due);
  s.advance(DAY); assert.equal((await s.tick()).sent, 1); d = s.sql.prepare('select * from telegram_deliveries').get();
  await s.callback(d.id, 'done', 123, d.message_id); assert.equal((await s.call(who, '/status')).reminders[0].completed, 1);
  await s.callback(d.id, 'later', 123, d.message_id); assert.equal(s.sql.prepare('select status from telegram_deliveries').get().status, 'completed');
});
test('Telegram 429 повторюється з затримкою, невизначений таймаут не створює дублікат', async () => {
  const s = setup(), who = await s.bind(); await s.reminder(who); s.advance(60 * MINUTE);
  s.transport(() => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 300 } }));
  assert.equal((await s.tick()).failed, 1); assert.equal((await s.tick()).sent, 0);
  s.advance(5 * MINUTE); s.transport(() => { throw new Error('network timeout with sensitive URL'); });
  const r = await s.tick(); assert.equal(r.failed, 1); assert(!JSON.stringify(r).includes('sensitive'));
  assert.equal(s.sql.prepare('select status from telegram_deliveries').get().status, 'failed');
  s.advance(DAY); assert.equal((await s.tick()).failed, 0);
});
test('тестове повідомлення йде лише у власний чат і обмежене одним на хвилину', async () => {
  const s = setup(), who = await s.bind(); s.calls.length = 0;
  assert.equal((await s.call(user('unbound'), '/test', { chat_id: '999' })).status, 409);
  assert.equal((await s.call(who, '/test', { chat_id: '999' })).status, 200);
  assert.equal(s.calls[0].body.chat_id, '123');
  assert.equal((await s.call(who, '/test', {})).status, 429);
  s.advance(MINUTE); assert.equal((await s.call(who, '/test', {})).status, 200);
});
test('переадресація Telegram не пересилає токен і завершується керованою помилкою', async () => {
  const s = setup(), who = await s.bind(); s.calls.length = 0;
  s.transport(() => new Response('', { status: 302, headers: { Location: 'https://untrusted.test' } }));
  assert.equal((await s.call(who, '/test', {})).status, 502); assert.equal(s.calls.length, 1);
});
test('квартплата підтримує оплату та правильний текст бота, без показників лічильника', async () => {
  const s = setup(), who = await s.bind();
  assert.equal((await s.call(who, '/reminders', { service: 'housing', kind: 'readings', day: 20, time: '09:00' })).status, 400);
  await s.reminder(who, { service: 'housing' }); s.calls.length = 0; s.advance(60 * MINUTE);
  assert.equal((await s.tick()).sent, 1); assert.match(s.calls[0].body.text, /Квартплата/);
  assert.equal(s.calls[0].body.reply_markup.inline_keyboard[1][0].text, 'Я оплатив');
});
test('блокування бота й /stop зупиняють надсилання', async () => {
  const s = setup(), who = await s.bind(); await s.reminder(who); s.advance(60 * MINUTE);
  s.transport(() => Response.json({ ok: false, error_code: 403 })); await s.tick(); assert.equal((await s.call(who, '/status')).binding, null);
  assert.equal(s.sql.prepare('select enabled from telegram_reminders').get().enabled, 0);
  s.transport(null); await s.bind(who); await s.webhook({ message: { chat: { type: 'private', id: 123 }, from: { id: 123 }, text: '/stop' } });
  assert.equal((await s.call(who, '/status')).binding, null);
});
