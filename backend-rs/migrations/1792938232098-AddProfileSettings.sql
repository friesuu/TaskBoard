-- AddProfileSettings1792938232098: the statements of ../backend/src/migrations/1792938232098-AddProfileSettings.ts, as TypeORM runs them
ALTER TABLE "users" ADD "display_name" character varying(50);
ALTER TABLE "tasks" ADD "completed_at" TIMESTAMP WITH TIME ZONE;
