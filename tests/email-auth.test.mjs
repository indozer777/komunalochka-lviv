import test from 'node:test';
import assert from 'node:assert/strict';
import { emailAuthConfig, resolveAccount, EmailAuthError } from '../server/email-auth.mjs';
import { handlePremiumRequest } from '../server/premium.mjs';
const env = { EMAIL_LOGIN_ENABLED: 'true', SUPABASE_URL: 'https://email-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'a'.repeat(32) };
const token = 'header.test-token-signature.value';
const request = authorization => new Request('https://komunalochka.com/api/premium/session', { headers: authorization === undefined ? {} : { Authorization: authorization } });
const identity = { id: 'a38cec6b-7826-44de-bd5f-987b331ca50c', email: 'person@example.test', email_confirmed_at: '2026-10-19T18:00:00Z', role: 'authenticated', is_anonymous: false };
const nativeUser = { userId: 'site-owner', email: 'owner@example.test', displayName: 'Owner' };
test('email login is disabled until explicit public-key configuration; secret keys and unsafe URLs never reach the browser', () => {
  assert.deepEqual(emailAuthConfig(), { enabled: false });
  for (const changes of [{ EMAIL_LOGIN_ENABLED: 'false' }, { SUPABASE_URL: 'http://email-test.supabase.co' }, { SUPABASE_URL: 'https://attacker.test' }, { SUPABASE_URL: 'https://email-test.supabase.co/redirect' }, { SUPABASE_URL: 'https://user:password@email-test.supabase.co/' }, { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private' }]) assert.deepEqual(emailAuthConfig({ ...env, ...changes }), { enabled: false });
  assert.equal(emailAuthConfig(env).publishableKey, env.SUPABASE_PUBLISHABLE_KEY);
});
test('native Sites identity is preserved; anonymous remains anonymous', async () => {
  assert.equal(await resolveAccount(request()), null);
  assert.deepEqual(await resolveAccount(request(), { nativeUser }), { ...nativeUser, authProvider: 'sites' });
});
test('verified email identity is scoped to provider and cannot inherit a same-email native identity or admin role', async () => {
  let called = 0;
  const user = await resolveAccount(request('Bearer ' + token), { env, nativeUser, fetcher: async (url, options) => {
    called++; assert.equal(url, env.SUPABASE_URL + '/auth/v1/user'); assert.equal(options.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY); assert.equal(options.headers.Authorization, 'Bearer ' + token); assert.equal(options.redirect, 'manual');
    return Response.json({ ...identity, email: nativeUser.email, user_metadata: { role: 'admin' } });
  } });
  assert.equal(called, 1); assert.equal(user.userId, 'email:' + identity.id); assert.equal(user.authProvider, 'email');
  const admin = await handlePremiumRequest(new Request('https://komunalochka.com/api/premium/admin'), { user, adminEmail: nativeUser.email, db: {} });
  assert.equal(admin.status, 403);
});
test('malformed and disabled bearer authentication never falls back to native owner', async () => {
  for (const value of ['Basic anything', 'Bearer short', 'Bearer ' + 'a'.repeat(9000)]) {
    await assert.rejects(resolveAccount(request(value), { env, nativeUser }), error => error instanceof EmailAuthError && error.status === 401);
  }
  await assert.rejects(resolveAccount(request('Bearer ' + token), { nativeUser }), error => error.status === 503);
});
test('rejected, expired or unconfirmed email tokens do not authenticate', async () => {
  for (const value of [new Response('', { status: 401 }), Response.json({ ...identity, email_confirmed_at: null }), Response.json({ ...identity, is_anonymous: true }), Response.json({ ...identity, role: 'service_role' }), Response.json({ ...identity, id: 'not-a-user-id' })]) {
    await assert.rejects(resolveAccount(request('Bearer ' + token), { env, nativeUser, fetcher: async () => value }), error => error.status === 401);
  }
});
test('provider outages, rate limiting and malformed replies fail closed with generic messages', async () => {
  for (const fetcher of [async () => { throw new Error('private provider failure'); }, async () => new Response('', { status: 429 }), async () => new Response('', { status: 503 }), async () => new Response('{invalid')]) {
    await assert.rejects(resolveAccount(request('Bearer ' + token), { env, fetcher }), error => error.status === 503 && !error.message.includes('private provider failure'));
  }
});
test('provider redirects are rejected without following them or using the native owner identity', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    await assert.rejects(resolveAccount(request('Bearer ' + token), { env, nativeUser, fetcher: async (url, options) => {
      calls++;
      assert.equal(url, env.SUPABASE_URL + '/auth/v1/user');
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status, headers: { Location: 'https://elsewhere.example.test' } });
    } }), error => error instanceof EmailAuthError && error.status === 503);
    assert.equal(calls, 1);
  }
});
