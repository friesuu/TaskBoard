import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiBuiltAt1793073308265 implements MigrationInterface {
    name = 'AddAiBuiltAt1793073308265'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" ADD "ai_built_at" TIMESTAMP WITH TIME ZONE`);
        // Tasks Claude has already built: when their last build finished. Not those in In progress, where a
        // build may be running right now.
        await queryRunner.query(`UPDATE "tasks" SET "ai_built_at" = COALESCE((SELECT MAX("finished_at") FROM "agent_runs" WHERE "agent_runs"."task_id" = "tasks"."id" AND "agent_runs"."step" = 'build'), now()) WHERE "ai_branch" IS NOT NULL AND "status" <> 'in_progress'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "ai_built_at"`);
    }

}
