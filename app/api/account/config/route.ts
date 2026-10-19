import { env } from 'cloudflare:workers';
import { accountJSON, emailAuthConfig } from '../../../../server/email-auth.mjs';
export const dynamic = 'force-dynamic';
export function GET() { return accountJSON(emailAuthConfig(env)); }
