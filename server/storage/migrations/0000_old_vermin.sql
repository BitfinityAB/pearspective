CREATE TABLE `change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`org` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`author_login` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`closed_at` text,
	`state` text NOT NULL,
	`head_sha` text,
	`head_ref` text NOT NULL,
	`base_ref` text NOT NULL,
	`is_draft` integer DEFAULT 0 NOT NULL,
	`merge_state` text,
	`review_decision` text,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`stack_number` integer,
	`stack_size` integer,
	`stack_position` integer,
	`stack_base_ref` text,
	`last_comment_author_login` text,
	`last_comment_snippet` text,
	`last_comment_url` text,
	`threads_truncated` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`author_login`) REFERENCES `people`(`login`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_comment_author_login`) REFERENCES `people`(`login`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "change_requests_state" CHECK("change_requests"."state" in ('open', 'merged', 'closed')),
	CONSTRAINT "change_requests_merge_state" CHECK("change_requests"."merge_state" is null or "change_requests"."merge_state" in ('clean', 'blocked', 'unstable', 'conflicts', 'behind', 'unknown')),
	CONSTRAINT "change_requests_review_decision" CHECK("change_requests"."review_decision" is null or "change_requests"."review_decision" in ('approved', 'review_required', 'changes_requested')),
	CONSTRAINT "change_requests_is_draft" CHECK("change_requests"."is_draft" in (0, 1)),
	CONSTRAINT "change_requests_threads_truncated" CHECK("change_requests"."threads_truncated" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `change_requests_org_repo` ON `change_requests` (`org`,`repo`);--> statement-breakpoint
CREATE TABLE `checks` (
	`change_request_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`required` integer NOT NULL,
	`url` text,
	PRIMARY KEY(`change_request_id`, `position`),
	FOREIGN KEY (`change_request_id`) REFERENCES `change_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "checks_state" CHECK("checks"."state" in ('success', 'pending', 'failure', 'neutral')),
	CONSTRAINT "checks_required" CHECK("checks"."required" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `not_tickets` (
	`key` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `people` (
	`login` text PRIMARY KEY NOT NULL,
	`name` text,
	`kind` text NOT NULL,
	`avatar_url` text,
	CONSTRAINT "people_kind" CHECK("people"."kind" in ('human', 'ai-review', 'code-analysis', 'bot'))
);
--> statement-breakpoint
CREATE TABLE `review_requests` (
	`change_request_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`login` text,
	`team_slug` text,
	`team_avatar_url` text,
	PRIMARY KEY(`change_request_id`, `position`),
	FOREIGN KEY (`change_request_id`) REFERENCES `change_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`login`) REFERENCES `people`(`login`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_requests_type" CHECK("review_requests"."type" in ('person', 'team'))
);
--> statement-breakpoint
CREATE TABLE `review_threads` (
	`change_request_id` text NOT NULL,
	`position` integer NOT NULL,
	`resolved` integer NOT NULL,
	`author_login` text NOT NULL,
	`snippet` text NOT NULL,
	`url` text NOT NULL,
	PRIMARY KEY(`change_request_id`, `position`),
	FOREIGN KEY (`change_request_id`) REFERENCES `change_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_login`) REFERENCES `people`(`login`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_threads_resolved" CHECK("review_threads"."resolved" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`change_request_id` text NOT NULL,
	`position` integer NOT NULL,
	`author_login` text NOT NULL,
	`state` text NOT NULL,
	`submitted_at` text NOT NULL,
	PRIMARY KEY(`change_request_id`, `position`),
	FOREIGN KEY (`change_request_id`) REFERENCES `change_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_login`) REFERENCES `people`(`login`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reviews_state" CHECK("reviews"."state" in ('approved', 'changes_requested', 'commented', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE `status_categories` (
	`status_name` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	CONSTRAINT "status_categories_category" CHECK("status_categories"."category" in ('todo', 'inProgress', 'done'))
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`key` text PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`type` text NOT NULL,
	`status_name` text NOT NULL,
	`assignee_login` text,
	`mine` integer,
	`url` text NOT NULL,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`assignee_login`) REFERENCES `people`(`login`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tickets_mine" CHECK("tickets"."mine" is null or "tickets"."mine" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `viewer_teams` (
	`slug` text PRIMARY KEY NOT NULL,
	`avatar_url` text
);
--> statement-breakpoint
CREATE TABLE `views` (
	`change_request_id` text NOT NULL,
	`view` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`view`, `change_request_id`),
	FOREIGN KEY (`change_request_id`) REFERENCES `change_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "views_view" CHECK("views"."view" in ('overview', 'authored', 'requested', 'team'))
);
