-- AddAiBuiltAt1793073308265: the statements of ../backend/src/migrations/1793073308265-AddAiBuiltAt.ts, as TypeORM runs them
ALTER TABLE "tasks" ADD "ai_built_at" TIMESTAMP WITH TIME ZONE;
UPDATE "tasks" SET "ai_built_at" = COALESCE((SELECT MAX("finished_at") FROM "agent_runs" WHERE "agent_runs"."task_id" = "tasks"."id" AND "agent_runs"."step" = 'build'), now()) WHERE "ai_branch" IS NOT NULL AND "status" <> 'in_progress';
