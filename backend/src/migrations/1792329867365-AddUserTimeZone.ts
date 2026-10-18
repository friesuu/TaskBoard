import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserTimeZone1792329867365 implements MigrationInterface {
    name = 'AddUserTimeZone1792329867365'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "time_zone" character varying(64)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "time_zone"`);
    }

}
