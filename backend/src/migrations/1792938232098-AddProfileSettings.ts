import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProfileSettings1792938232098 implements MigrationInterface {
    name = 'AddProfileSettings1792938232098'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "display_name" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "completed_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "completed_at"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "display_name"`);
    }

}
