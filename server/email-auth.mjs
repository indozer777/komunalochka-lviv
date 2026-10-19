/* Managed email identity. Native Sites authentication remains unchanged. */
export class EmailAuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function emailAuthConfig(env = {}) {
  if (env.EMAIL_LOGIN_ENABLED !== 'true') return { enabled: false };
  try {
    const url = new URL(env.SUPABASE_URL);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') return { enabled: false };
    const key = env.SUPABASE_PUBLISHABLE_KEY;
    if (typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{16,200}$/.test(key)) return { enabled: false };
    return { enabled: true, url: url.origin, publishableKey: key, otpLength: 6 };
  } catch { return { enabled: false }; }
}
export const accountJSON = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie, Authorization',
} });
/**
 * @param {Request} request
 * @param {{ env?: { EMAIL_LOGIN_ENABLED?: string, SUPABASE_URL?: string, SUPABASE_PUBLISHABLE_KEY?: string }, nativeUser?: { userId: string, email: string, displayName: string, fullName?: string | null } | null, fetcher?: typeof fetch }} options
 */
export async function resolveAccount(request, { env = {}, nativeUser = null, fetcher = fetch } = {}) {
  const authorization = request.headers.get('Authorization');
  if (authorization === null) return nativeUser ? { ...nativeUser, authProvider: 'sites' } : null;
  const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]{20,8192})$/);
  if (!match) throw new EmailAuthError(401, 'Не вдалося перевірити вхід. Увійдіть знову.');
  const config = emailAuthConfig(env);
  if (!config.enabled) throw new EmailAuthError(503, 'Вхід поштою ще не налаштовано. Доступний чинний вхід через ChatGPT.');
  let response;
  try {
    response = await fetcher(config.url + '/auth/v1/user', { method: 'GET', redirect: 'error',
      headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + match[1] }, signal: AbortSignal.timeout(6000) });
  } catch { throw new EmailAuthError(503, 'Не вдалося перевірити акаунт. Перевірте з’єднання та спробуйте ще раз.'); }
  if (response.status === 429 || response.status >= 500) throw new EmailAuthError(503, 'Сервіс входу тимчасово зайнятий. Спробуйте трохи пізніше.');
  if (!response.ok) throw new EmailAuthError(401, 'Вхід завершився. Увійдіть знову за кодом із листа.');
  let user;
  try { user = await response.json(); } catch { throw new EmailAuthError(503, 'Сервіс входу повернув неповну відповідь. Спробуйте ще раз.'); }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(user?.id || '') || typeof user.email !== 'string' || user.email.length > 254 || !user.email.includes('@') || !user.email_confirmed_at || user.is_anonymous === true || user.role !== 'authenticated') {
    throw new EmailAuthError(401, 'Підтвердьте свою пошту кодом із листа.');
  }
  // A confirmed address never merges another identity or grants administration.
  return { userId: 'email:' + user.id, email: user.email, displayName: user.email, fullName: null, authProvider: 'email' };
}
