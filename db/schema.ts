import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
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

export const telegramBindings = sqliteTable('telegram_bindings', {
  userId: text('user_id').primaryKey(), chatId: text('chat_id').notNull().unique(),
  name: text('name').notNull(), connectedAt: integer('connected_at').notNull(),
});
export const telegramLinks = sqliteTable('telegram_links', {
  hash: text('hash').primaryKey(), userId: text('user_id').notNull(), createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(), chatId: text('chat_id'), name: text('name'),
}, t => [index('telegram_link_user').on(t.userId)]);
export const telegramReminders = sqliteTable('telegram_reminders', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), service: text('service').notNull(), kind: text('kind').notNull(),
  day: integer('day').notNull(), time: text('time').notNull(), enabled: integer('enabled').notNull().default(1),
  deleted: integer('deleted').notNull().default(0), nextDue: integer('next_due').notNull(),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, t => [index('telegram_due').on(t.enabled, t.deleted, t.nextDue), index('telegram_reminder_user').on(t.userId)]);
export const telegramCompleted = sqliteTable('telegram_completed', {
  reminderId: text('reminder_id').notNull().references(() => telegramReminders.id),
  period: text('period').notNull(), completedAt: integer('completed_at').notNull(),
}, t => [primaryKey({ columns: [t.reminderId, t.period] })]);
export const telegramDeliveries = sqliteTable('telegram_deliveries', {
  id: text('id').primaryKey(), reminderId: text('reminder_id').notNull().references(() => telegramReminders.id),
  period: text('period').notNull(), chatId: text('chat_id').notNull(), status: text('status').notNull(),
  nextAt: integer('next_at'), leaseUntil: integer('lease_until').notNull().default(0), attempts: integer('attempts').notNull().default(0),
  messageId: integer('message_id'), sentAt: integer('sent_at'), createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('telegram_delivery_month').on(t.reminderId, t.period), index('telegram_delivery_queue').on(t.status, t.nextAt)]);
export const telegramUpdates = sqliteTable('telegram_updates', {
  id: integer('id').primaryKey(), createdAt: integer('created_at').notNull(),
});
export const telegramLeases = sqliteTable('telegram_leases', {
  name: text('name').primaryKey(), leaseUntil: integer('lease_until').notNull().default(0),
});
