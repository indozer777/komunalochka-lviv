import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handlePremiumRequest, hashPromoCode } from '../server/premium.mjs';

const NOW = Date.parse('2026-10-19T18:00:00Z'), DAY = 86400000;
const user = id => ({ userId: id, email: id + '@example.test', displayName: 'Користувач ' + id });
function setup() {
  const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  const db = {
    prepare(text) {
      let args = [];
      return { bind(...values) { args = values; return this; },
        async first() { return sql.prepare(text).get(...args) || null; },
        async all() { return { results: sql.prepare(text).all(...args) }; },
        async run() { return this.execute(); },
        execute() { const result = sql.prepare(text).run(...args); return { meta: { changes: Number(result.changes) }, success: true }; },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => s.execute()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  let now = NOW;
  const context = who => ({ db, user: who, adminEmail: 'admin@example.test', now: () => now });
  async function call(who, path, body, headers = {}) {
    const method = body === undefined ? 'GET' : 'POST';
    const request = new Request('https://app.test/api/premium' + path, { method,
      headers: { Origin: 'https://app.test', 'Content-Type': 'application/json', 'X-Komunalochka-Request': '1', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const response = await handlePremiumRequest(request, context(who));
    return { status: response.status, headers: response.headers, ...(await response.json()) };
  }
  const admin = user('admin');
  const code = async (options = {}) => {
    const result = await call(admin, '/admin/codes', { label: 'Тестовий доступ', maxUses: 1, validityDays: 30, accessDays: 30, ...options });
    assert.equal(result.status, 201); return result;
  };
  return { sql, db, context, call, admin, code, advance: ms => { now += ms; } };
}

test('анонімний калькулятор дозволений, Premium і адміністрування потребують правильної особи', async () => {
  const s = setup();
  const anonymous = await s.call(null, '/session'); assert.equal(anonymous.status, 200); assert.equal(anonymous.user, null); assert.equal(anonymous.access.active, false);
  assert.equal((await s.call(null, '/redeem', { code: 'TEST-ONLY-FREE-CODE' })).status, 401);
  assert.equal((await s.call(null, '/admin')).status, 401);
  assert.equal((await s.call(user('visitor'), '/admin')).status, 403);
  assert.equal((await s.call(user('visitor'), '/admin/codes', {})).status, 403);
  const owner = await s.call(s.admin, '/session'); assert.equal(owner.isAdmin, true); assert.equal(owner.access.active, true);
  const request = new Request('https://app.test/api/premium/session');
  const noConfig = await (await handlePremiumRequest(request, { ...s.context(s.admin), adminEmail: '' })).json(); assert.equal(noConfig.isAdmin, false);
});

test('промокод прихований за SHA-256, має ліміт і не продовжує доступ при повторному введенні', async () => {
  const s = setup(), promo = await s.code(), person = user('one');
  assert.match(promo.code, /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/);
  const stored = s.sql.prepare('SELECT * FROM premium_codes').get(); assert.equal(stored.code_hash, await hashPromoCode(promo.code)); assert.equal(Object.values(stored).includes(promo.code), false);
  const grant = await s.call(person, '/redeem', { code: promo.code.toLowerCase() }); assert.equal(grant.status, 200); assert.equal(grant.access.expiresAt, NOW + 30 * DAY);
  const repeated = await s.call(person, '/redeem', { code: promo.code }); assert.equal(repeated.status, 200); assert.equal(repeated.access.expiresAt, grant.access.expiresAt);
  assert.equal(s.sql.prepare('SELECT used_count FROM premium_codes').get().used_count, 1);
  assert.equal((await s.call(user('two'), '/redeem', { code: promo.code })).status, 409);
  const dashboard = await s.call(s.admin, '/admin'); assert.equal(JSON.stringify(dashboard).includes(stored.code_hash), false); assert.equal(JSON.stringify(dashboard).includes(promo.code), false);
  assert.equal(dashboard.counts.active, 1); assert.equal(grant.headers.get('Cache-Control'), 'private, no-store');
});

test('одночасні активації не обходять загальний ліміт', async () => {
  const s = setup(), promo = await s.code({ maxUses: 1 });
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => s.call(user('race' + i), '/redeem', { code: promo.code })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM premium_access').get().n, 1);
  assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM premium_redemptions').get().n, 1);
  assert.equal(s.sql.prepare('SELECT used_count FROM premium_codes').get().used_count, 1);
});

test('вимкнений або прострочений код не надає доступ', async () => {
  const s = setup(), disabled = await s.code(), expired = await s.code({ validityDays: 1 });
  assert.equal((await s.call(s.admin, '/admin/codes/' + disabled.id, { enabled: false })).status, 200);
  assert.equal((await s.call(user('blocked'), '/redeem', { code: disabled.code })).status, 409);
  s.advance(2 * DAY);
  assert.equal((await s.call(user('expired'), '/redeem', { code: expired.code })).status, 409);
  assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM premium_access').get().n, 0);
  assert.equal((await s.call(s.admin, '/admin/codes/' + disabled.id, { enabled: true })).status, 200);
  assert.equal((await s.call(user('enabled'), '/redeem', { code: disabled.code })).status, 200);
});

test('строки додаються коректно, безстроковий доступ зберігається, відкликаний не відновлюється старим кодом', async () => {
  const s = setup(), person = user('duration');
  for (let n = 0; n < 2; n++) { const c = await s.code(); assert.equal((await s.call(person, '/redeem', { code: c.code })).status, 200); }
  assert.equal((await s.call(person, '/session')).access.expiresAt, NOW + 60 * DAY);
  const forever = await s.code({ accessDays: null }); await s.call(person, '/redeem', { code: forever.code });
  const finite = await s.code(); await s.call(person, '/redeem', { code: finite.code });
  assert.equal((await s.call(person, '/session')).access.expiresAt, null);
  await s.call(s.admin, '/admin/access/' + person.userId, { action: 'revoke' });
  assert.equal((await s.call(person, '/session')).access.active, false);
  await s.call(person, '/redeem', { code: forever.code }); assert.equal((await s.call(person, '/session')).access.active, false);
  const fresh = await s.code(); await s.call(person, '/redeem', { code: fresh.code });
  assert.equal((await s.call(person, '/session')).access.expiresAt, NOW + 30 * DAY);
  s.advance(30 * DAY); assert.equal((await s.call(person, '/session')).access.active, false);
});

test('заявка належить акаунту; лише адміністратор може її схвалити і надати доступ', async () => {
  const s = setup(), person = user('requester');
  const pending = await s.call(person, '/requests', { message: 'Потрібна історія витрат для родини.' }); assert.equal(pending.status, 200); assert.equal(pending.request.status, 'pending');
  assert.equal((await s.call(person, '/requests', { message: 'Повторне звернення користувача.' })).status, 429);
  assert.equal((await s.call(user('other'), '/session')).request, null);
  assert.equal((await s.call(user('other'), '/admin/requests/' + pending.request.id, { decision: 'approved', accessDays: null })).status, 403);
  const approved = await s.call(s.admin, '/admin/requests/' + pending.request.id, { decision: 'approved', accessDays: 365, note: 'Вітаємо <тест>!' }); assert.equal(approved.status, 200);
  const result = await s.call(person, '/session'); assert.equal(result.request.status, 'approved'); assert.equal(result.request.note, 'Вітаємо <тест>!'); assert.equal(result.access.expiresAt, NOW + 365 * DAY);
  assert.equal((await s.call(s.admin, '/admin/requests/' + pending.request.id, { decision: 'declined' })).status, 409);
  assert.equal((await s.call(person, '/requests', { message: 'Ще один запит при активному доступі.' })).status, 409);
});

test('паралельні рішення за заявкою дають рівно одне надання доступу', async () => {
  const s = setup(), person = user('review-race');
  const request = await s.call(person, '/requests', { message: 'Хочу графіки використання води.' });
  const decisions = await Promise.all([30, 365].map(accessDays => s.call(s.admin, '/admin/requests/' + request.request.id, { decision: 'approved', accessDays })));
  assert.equal(decisions.filter(r => r.status === 200).length, 1); assert.equal(decisions.filter(r => r.status === 409).length, 1);
  assert.equal((await s.call(person, '/session')).access.expiresAt, NOW + 30 * DAY);
});

test('відхилення не надає доступ, нова заявка можлива через добу без втрати історії', async () => {
  const s = setup(), person = user('declined');
  const request = await s.call(person, '/requests', { message: 'Хочу спробувати додаткові функції.' });
  await s.call(s.admin, '/admin/requests/' + request.request.id, { decision: 'declined', note: 'Уточніть звернення.' });
  assert.equal((await s.call(person, '/session')).access.active, false);
  assert.equal((await s.call(person, '/requests', { message: 'Нове уточнене звернення користувача.' })).status, 429);
  s.advance(DAY + 1);
  assert.equal((await s.call(person, '/requests', { message: 'Нове уточнене звернення користувача.' })).status, 200);
  assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM premium_requests').get().n, 2);
});

test('CSRF, некоректні типи, завеликі тіла та перебір кодів відхиляються', async () => {
  const s = setup(), person = user('security');
  assert.equal((await s.call(person, '/redeem', { code: 'TEST-ONLY-FREE-CODE' }, { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await s.call(person, '/redeem', {}, { 'X-Komunalochka-Request': '' })).status, 403);
  assert.equal((await s.call(person, '/redeem', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await s.call(person, '/requests', { message: 'x'.repeat(9000) })).status, 413);
  assert.equal((await s.call(person, '/requests', '{bad json')).status, 400);
  assert.equal((await s.call(s.admin, '/admin/codes', { label: 'Код', maxUses: -1, validityDays: null, accessDays: null })).status, 400);
  for (let n = 0; n < 10; n++) assert.equal((await s.call(person, '/redeem', { code: 'AAAA-BBBB-CCCC-DDDD' })).status, 400);
  assert.equal((await s.call(person, '/redeem', { code: 'AAAA-BBBB-CCCC-DDDD' })).status, 429);
  assert.equal((await s.call(user('independent'), '/redeem', { code: 'AAAA-BBBB-CCCC-DDDD' })).status, 400);
  s.advance(16 * 60000); assert.equal((await s.call(person, '/redeem', { code: 'AAAA-BBBB-CCCC-DDDD' })).status, 400);
});
