-- AddClaudeRunner1793065936801: the statements of ../backend/src/migrations/1793065936801-AddClaudeRunner.ts, as TypeORM runs them
CREATE TABLE "runner_tokens" ("id" SERIAL NOT NULL, "token_hash" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_used_at" TIMESTAMP WITH TIME ZONE, "owner_id" integer NOT NULL, CONSTRAINT "UQ_08addec2b824fc70d89c9da9e40" UNIQUE ("token_hash"), CONSTRAINT "UQ_3abb1325320b55960ef784d2802" UNIQUE ("owner_id"), CONSTRAINT "PK_3251d28fcedb84c470ff0ad639d" PRIMARY KEY ("id"));
ALTER TABLE "boards" ADD "project" character varying(50);
ALTER TABLE "tasks" ADD "refined_prompt" text;
ALTER TABLE "tasks" ADD "changes_requested" boolean NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD "approved_prompt" text;
ALTER TABLE "tasks" ADD "prompt_approved_at" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "tasks" ADD "ai_branch" character varying(100);
ALTER TABLE "tasks" ADD "ai_error" text;
ALTER TABLE "comments" ADD "from_runner" boolean NOT NULL DEFAULT false;
DROP INDEX "public"."IDX_32c344d872e5f545fcdb5a2f31";
ALTER TYPE "public"."tasks_status_enum" ADD VALUE 'prompt_review';
ALTER TYPE "public"."tasks_status_enum" ADD VALUE 'ai_review';
CREATE INDEX "IDX_32c344d872e5f545fcdb5a2f31" ON "tasks"  ("board_id", "status", "position") ;
ALTER TABLE "runner_tokens" ADD CONSTRAINT "FK_3abb1325320b55960ef784d2802" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
