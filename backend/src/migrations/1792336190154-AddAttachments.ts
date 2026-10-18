import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAttachments1792336190154 implements MigrationInterface {
    name = 'AddAttachments1792336190154'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "attachments" ("id" SERIAL NOT NULL, "file_name" character varying(200) NOT NULL, "mime_type" character varying(120) NOT NULL, "size" integer NOT NULL, "storage_key" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "task_id" integer NOT NULL, CONSTRAINT "UQ_ec3648b85f6af7eafe865a3257b" UNIQUE ("storage_key"), CONSTRAINT "PK_5e1f050bcff31e3084a1d662412" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c2b74c0aff9fab83174e80db0a" ON "attachments"  ("task_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "attachments" ADD CONSTRAINT "FK_e62fd181b97caa6b150b09220b1" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "attachments" DROP CONSTRAINT "FK_e62fd181b97caa6b150b09220b1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c2b74c0aff9fab83174e80db0a"`);
        await queryRunner.query(`DROP TABLE "attachments"`);
    }

}
