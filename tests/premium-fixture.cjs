/* Browser-only fixtures; these codes are never installed on the server. */
module.exports = async (context, { active = false } = {}) => {
  const session = () => ({ user: { id: 'fixture-person', email: 'person@example.test', name: 'Тестова людина' }, isAdmin: false,
    access: { active, expiresAt: active ? null : undefined, source: active ? 'promo' : null }, request: null,
    signIn: '/signin-with-chatgpt?return_to=%2F', signOut: '/signout-with-chatgpt?return_to=%2F', serverTime: Date.now() });
  await context.route('**/api/premium/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session()) });
    if (path.endsWith('/redeem')) {
      if (route.request().postDataJSON().code !== 'TEST-ONLY-FREE-CODE') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Промокод недоступний.' }) });
      active = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session()) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
};
