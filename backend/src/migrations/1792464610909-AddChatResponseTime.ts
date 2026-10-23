import { MigrationInterface, QueryRunner } from "typeorm";

export class AddChatResponseTime1792464610909 implements MigrationInterface {
    name = 'AddChatResponseTime1792464610909'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_messages" ADD "response_ms" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "response_ms"`);
    }

}
