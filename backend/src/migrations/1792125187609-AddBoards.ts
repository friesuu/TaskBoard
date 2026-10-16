import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBoards1792125187609 implements MigrationInterface {
    name = 'AddBoards1792125187609'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "boards" ("id" SERIAL NOT NULL, "name" character varying(100) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "owner_id" integer NOT NULL, CONSTRAINT "PK_606923b0b068ef262dfdcd18f44" PRIMARY KEY ("id"))`);
        // Existing data: every user gets a "My board", and their tasks move onto it.
        // board_id starts optional (existing tasks have none yet), is filled in, and only then becomes required.
        await queryRunner.query(`INSERT INTO "boards" ("name", "owner_id") SELECT 'My board', "id" FROM "users"`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "board_id" integer`);
        await queryRunner.query(`UPDATE "tasks" t SET "board_id" = b."id" FROM "boards" b WHERE b."owner_id" = t."owner_id"`);
        await queryRunner.query(`ALTER TABLE "tasks" ALTER COLUMN "board_id" SET NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_32c344d872e5f545fcdb5a2f31" ON "tasks"  ("board_id", "status", "position") `);
        await queryRunner.query(`ALTER TABLE "boards" ADD CONSTRAINT "FK_a20a7418b96eda28e1318408472" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_2680b7f3ecd70b05030ce6b4aef" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_2680b7f3ecd70b05030ce6b4aef"`);
        await queryRunner.query(`ALTER TABLE "boards" DROP CONSTRAINT "FK_a20a7418b96eda28e1318408472"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_32c344d872e5f545fcdb5a2f31"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "board_id"`);
        await queryRunner.query(`DROP TABLE "boards"`);
    }

}
