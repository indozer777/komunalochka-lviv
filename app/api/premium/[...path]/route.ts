import { env } from 'cloudflare:workers';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from '../../../chatgpt-auth';
import { handlePremiumRequest } from '../../../../server/premium.mjs';
import { resolveAccount, accountJSON, EmailAuthError } from '../../../../server/email-auth.mjs';

export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    const nativeUser = await getChatGPTUser();
    return handlePremiumRequest(request, {
      db: env.DB, user: await resolveAccount(request, { env, nativeUser }), hasSiteSession: Boolean(nativeUser),
      adminEmail: env.PREMIUM_ADMIN_EMAIL, allowedOrigins: env.PREMIUM_ALLOWED_ORIGINS,
      signIn: chatGPTSignInPath('/?premium=1'), signOut: chatGPTSignOutPath('/'),
    });
  } catch (error) {
    return accountJSON({ error: error instanceof EmailAuthError ? error.message : 'Не вдалося перевірити акаунт. Спробуйте ще раз.' }, error instanceof EmailAuthError ? error.status : 500);
  }
}
export { handle as GET, handle as POST };
