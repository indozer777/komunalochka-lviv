import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../../chatgpt-auth';
import { resolveAccount, accountJSON, EmailAuthError } from '../../../../server/email-auth.mjs';
import { handleTelegramRequest } from '../../../../server/telegram.mjs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    const serviceCall = /\/api\/telegram\/(webhook|tick)$/.test(new URL(request.url).pathname);
    const user = serviceCall ? null : await resolveAccount(request, { env, nativeUser: await getChatGPTUser() });
    return handleTelegramRequest(request, { db: env.DB, env, user });
  } catch (error) { return accountJSON({ error: error instanceof EmailAuthError ? error.message : 'Не вдалося перевірити акаунт.' }, error instanceof EmailAuthError ? error.status : 500); }
}
export { handle as GET, handle as POST };
