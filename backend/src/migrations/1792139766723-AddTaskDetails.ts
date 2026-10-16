import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTaskDetails1792139766723 implements MigrationInterface {
    name = 'AddTaskDetails1792139766723'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "checklist_items" ("id" SERIAL NOT NULL, "text" character varying(200) NOT NULL, "done" boolean NOT NULL DEFAULT false, "position" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "task_id" integer NOT NULL, CONSTRAINT "PK_bae00945a1d4789bd648e583e29" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3d41ef1276ef399ec69dcefa88" ON "checklist_items"  ("task_id", "position") `);
        await queryRunner.query(`CREATE TABLE "comments" ("id" SERIAL NOT NULL, "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "task_id" integer NOT NULL, "author_id" integer NOT NULL, CONSTRAINT "PK_8bf68bc960f2b69e818bdb90dcb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8657ba08a46e505f8cbbcf9b8a" ON "comments"  ("task_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "checklist_items" ADD CONSTRAINT "FK_ddce58fe3b634074f0eb8168d43" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comments" ADD CONSTRAINT "FK_18c2493067c11f44efb35ca0e03" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comments" ADD CONSTRAINT "FK_e6d38899c31997c45d128a8973b" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_e6d38899c31997c45d128a8973b"`);
        await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_18c2493067c11f44efb35ca0e03"`);
        await queryRunner.query(`ALTER TABLE "checklist_items" DROP CONSTRAINT "FK_ddce58fe3b634074f0eb8168d43"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8657ba08a46e505f8cbbcf9b8a"`);
        await queryRunner.query(`DROP TABLE "comments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3d41ef1276ef399ec69dcefa88"`);
        await queryRunner.query(`DROP TABLE "checklist_items"`);
    }

}
