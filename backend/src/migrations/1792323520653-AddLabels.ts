import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLabels1792323520653 implements MigrationInterface {
    name = 'AddLabels1792323520653'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."labels_color_enum" AS ENUM('gray', 'blue', 'purple', 'teal', 'green', 'yellow', 'orange', 'pink')`);
        await queryRunner.query(`CREATE TABLE "labels" ("id" SERIAL NOT NULL, "name" character varying(30) NOT NULL, "color" "public"."labels_color_enum" NOT NULL DEFAULT 'gray', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "board_id" integer NOT NULL, CONSTRAINT "PK_c0c4e97f76f1f3a268c7a70b925" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2b2cab7d734e3d8c71622e7e79" ON "labels"  ("board_id", "name") `);
        await queryRunner.query(`CREATE TABLE "task_labels" ("task_id" integer NOT NULL, "label_id" integer NOT NULL, CONSTRAINT "PK_d46d4e476e3f6f8bf272b2bc1eb" PRIMARY KEY ("task_id", "label_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_844df22351eb86c33c3e8c132f" ON "task_labels"  ("task_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_09dd3f6f9d04063726c498155f" ON "task_labels"  ("label_id") `);
        await queryRunner.query(`ALTER TABLE "labels" ADD CONSTRAINT "FK_8c01957f89bcb4364bb5b4b35ce" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "task_labels" ADD CONSTRAINT "FK_844df22351eb86c33c3e8c132f4" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "task_labels" ADD CONSTRAINT "FK_09dd3f6f9d04063726c498155f2" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "task_labels" DROP CONSTRAINT "FK_09dd3f6f9d04063726c498155f2"`);
        await queryRunner.query(`ALTER TABLE "task_labels" DROP CONSTRAINT "FK_844df22351eb86c33c3e8c132f4"`);
        await queryRunner.query(`ALTER TABLE "labels" DROP CONSTRAINT "FK_8c01957f89bcb4364bb5b4b35ce"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_09dd3f6f9d04063726c498155f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_844df22351eb86c33c3e8c132f"`);
        await queryRunner.query(`DROP TABLE "task_labels"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2b2cab7d734e3d8c71622e7e79"`);
        await queryRunner.query(`DROP TABLE "labels"`);
        await queryRunner.query(`DROP TYPE "public"."labels_color_enum"`);
    }

}
