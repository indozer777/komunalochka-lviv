import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const premiumUsers = sqliteTable('premium_users', {
  id: text('id').primaryKey(), email: text('email').notNull(), name: text('name').notNull(),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
});
export const premiumAccess = sqliteTable('premium_access', {
  userId: text('user_id').primaryKey().references(() => premiumUsers.id),
  expiresAt: integer('expires_at'), revoked: integer('revoked').notNull().default(0),
  source: text('source').notNull(), updatedAt: integer('updated_at').notNull(), grantedBy: text('granted_by').notNull(),
});
export const premiumCodes = sqliteTable('premium_codes', {
  id: text('id').primaryKey(), codeHash: text('code_hash').notNull().unique(), label: text('label').notNull(),
  maxUses: integer('max_uses').notNull(), usedCount: integer('used_count').notNull().default(0),
  expiresAt: integer('expires_at'), accessDays: integer('access_days'), enabled: integer('enabled').notNull().default(1),
  createdAt: integer('created_at').notNull(), createdBy: text('created_by').notNull(),
});
export const premiumRedemptions = sqliteTable('premium_redemptions', {
  id: text('id').primaryKey(), codeId: text('code_id').notNull().references(() => premiumCodes.id),
  userId: text('user_id').notNull().references(() => premiumUsers.id), redeemedAt: integer('redeemed_at').notNull(),
}, t => [uniqueIndex('premium_redemption_once').on(t.codeId, t.userId)]);
export const premiumRequests = sqliteTable('premium_requests', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => premiumUsers.id),
  message: text('message').notNull(), status: text('status').notNull(), createdAt: integer('created_at').notNull(),
  reviewedAt: integer('reviewed_at'), reviewedBy: text('reviewed_by'), reviewId: text('review_id'),
  note: text('note').notNull().default(''),
}, t => [uniqueIndex('premium_request_pending').on(t.userId).where(sql`${t.status} = 'pending'`), index('premium_request_queue').on(t.status, t.createdAt)]);
export const premiumLimits = sqliteTable('premium_limits', {
  key: text('key').primaryKey(), windowStart: integer('window_start').notNull(), attempts: integer('attempts').notNull(),
});
