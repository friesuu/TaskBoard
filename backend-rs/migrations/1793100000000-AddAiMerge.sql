-- AddAiMerge1793100000000: the statements of ../backend/src/migrations/1793100000000-AddAiMerge.ts, as TypeORM runs them
ALTER TABLE "tasks" ADD "ai_merge_requested_at" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "tasks" ADD "ai_merged_at" TIMESTAMP WITH TIME ZONE;
