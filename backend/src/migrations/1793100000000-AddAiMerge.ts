import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiMerge1793100000000 implements MigrationInterface {
    name = 'AddAiMerge1793100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // You clicked Merge (the runner merges the task's branch on its next check), and when it did
        await queryRunner.query(`ALTER TABLE "tasks" ADD "ai_merge_requested_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "ai_merged_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "ai_merged_at"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "ai_merge_requested_at"`);
    }

}
