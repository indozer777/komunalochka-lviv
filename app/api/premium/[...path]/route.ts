import { env } from 'cloudflare:workers';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from '../../../chatgpt-auth';
import { handlePremiumRequest } from '../../../../server/premium.mjs';

export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  return handlePremiumRequest(request, {
    db: env.DB, user: await getChatGPTUser(),
    adminEmail: env.PREMIUM_ADMIN_EMAIL, allowedOrigins: env.PREMIUM_ALLOWED_ORIGINS,
    signIn: chatGPTSignInPath('/?premium=1'), signOut: chatGPTSignOutPath('/'),
  });
}
export { handle as GET, handle as POST };
