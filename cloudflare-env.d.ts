declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    PREMIUM_ADMIN_EMAIL?: string;
    PREMIUM_ALLOWED_ORIGINS?: string;
  }
}
