declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    PREMIUM_ADMIN_EMAIL?: string;
    PREMIUM_ALLOWED_ORIGINS?: string;
    EMAIL_LOGIN_ENABLED?: string;
    SUPABASE_URL?: string;
    SUPABASE_PUBLISHABLE_KEY?: string;
  }
}
