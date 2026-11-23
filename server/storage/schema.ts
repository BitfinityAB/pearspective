import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const isBool = (column: unknown) => sql`${column} in (0, 1)`;

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const viewerTeams = sqliteTable('viewer_teams', {
  slug: text('slug').primaryKey(),
  avatarUrl: text('avatar_url'),
});

export const people = sqliteTable('people', {
  login: text('login').primaryKey(),
  name: text('name'),
  kind: text('kind').notNull(),
  avatarUrl: text('avatar_url'),
}, (table) => [check('people_kind', sql`${table.kind} in ('human', 'ai-review', 'code-analysis', 'bot')`)]);

export const changeRequests = sqliteTable('change_requests', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  org: text('org').notNull(),
  repo: text('repo').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  authorLogin: text('author_login').notNull().references(() => people.login),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  closedAt: text('closed_at'),
  state: text('state').notNull(),
  headSha: text('head_sha'),
  headRef: text('head_ref').notNull(),
  baseRef: text('base_ref').notNull(),
  isDraft: integer('is_draft').notNull().default(0),
  mergeState: text('merge_state'),
  reviewDecision: text('review_decision'),
  commentCount: integer('comment_count').notNull().default(0),
  stackNumber: integer('stack_number'),
  stackSize: integer('stack_size'),
  stackPosition: integer('stack_position'),
  stackBaseRef: text('stack_base_ref'),
  lastCommentAuthorLogin: text('last_comment_author_login').references(() => people.login),
  lastCommentSnippet: text('last_comment_snippet'),
  lastCommentUrl: text('last_comment_url'),
  threadsTruncated: integer('threads_truncated').notNull().default(0),
}, (table) => [
  index('change_requests_org_repo').on(table.org, table.repo),
  check('change_requests_state', sql`${table.state} in ('open', 'merged', 'closed')`),
  check('change_requests_merge_state', sql`${table.mergeState} is null or ${table.mergeState} in ('clean', 'blocked', 'unstable', 'conflicts', 'behind', 'unknown')`),
  check('change_requests_review_decision', sql`${table.reviewDecision} is null or ${table.reviewDecision} in ('approved', 'review_required', 'changes_requested')`),
  check('change_requests_is_draft', isBool(table.isDraft)),
  check('change_requests_threads_truncated', isBool(table.threadsTruncated)),
]);

const changeRequestId = () => text('change_request_id').notNull().references(() => changeRequests.id, { onDelete: 'cascade' });

export const checks = sqliteTable('checks', {
  changeRequestId: changeRequestId(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  state: text('state').notNull(),
  required: integer('required').notNull(),
  url: text('url'),
}, (table) => [
  primaryKey({ columns: [table.changeRequestId, table.position] }),
  check('checks_state', sql`${table.state} in ('success', 'pending', 'failure', 'neutral')`),
  check('checks_required', isBool(table.required)),
]);

export const reviews = sqliteTable('reviews', {
  changeRequestId: changeRequestId(),
  position: integer('position').notNull(),
  authorLogin: text('author_login').notNull().references(() => people.login),
  state: text('state').notNull(),
  submittedAt: text('submitted_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.changeRequestId, table.position] }),
  check('reviews_state', sql`${table.state} in ('approved', 'changes_requested', 'commented', 'dismissed')`),
]);

export const reviewThreads = sqliteTable('review_threads', {
  changeRequestId: changeRequestId(),
  position: integer('position').notNull(),
  resolved: integer('resolved').notNull(),
  authorLogin: text('author_login').notNull().references(() => people.login),
  snippet: text('snippet').notNull(),
  url: text('url').notNull(),
}, (table) => [
  primaryKey({ columns: [table.changeRequestId, table.position] }),
  check('review_threads_resolved', isBool(table.resolved)),
]);

export const reviewRequests = sqliteTable('review_requests', {
  changeRequestId: changeRequestId(),
  position: integer('position').notNull(),
  type: text('type').notNull(),
  login: text('login').references(() => people.login),
  teamSlug: text('team_slug'),
  teamAvatarUrl: text('team_avatar_url'),
}, (table) => [
  primaryKey({ columns: [table.changeRequestId, table.position] }),
  check('review_requests_type', sql`${table.type} in ('person', 'team')`),
]);

export const views = sqliteTable('views', {
  changeRequestId: changeRequestId(),
  view: text('view').notNull(),
  position: integer('position').notNull(),
}, (table) => [
  primaryKey({ columns: [table.view, table.changeRequestId] }),
  check('views_view', sql`${table.view} in ('overview', 'authored', 'requested', 'team')`),
]);

export const tickets = sqliteTable('tickets', {
  key: text('key').primaryKey(),
  summary: text('summary').notNull(),
  type: text('type').notNull(),
  statusName: text('status_name').notNull(),
  assigneeLogin: text('assignee_login').references(() => people.login),
  mine: integer('mine'),
  url: text('url').notNull(),
  fetchedAt: text('fetched_at').notNull(),
}, (table) => [check('tickets_mine', sql`${table.mine} is null or ${table.mine} in (0, 1)`)]);

export const statusCategories = sqliteTable('status_categories', {
  statusName: text('status_name').primaryKey(),
  category: text('category').notNull(),
}, (table) => [check('status_categories_category', sql`${table.category} in ('todo', 'inProgress', 'done')`)]);

export const notTickets = sqliteTable('not_tickets', {
  key: text('key').primaryKey(),
});
