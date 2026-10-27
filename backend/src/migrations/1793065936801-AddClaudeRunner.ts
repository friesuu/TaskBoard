import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClaudeRunner1793065936801 implements MigrationInterface {
    name = 'AddClaudeRunner1793065936801'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "runner_tokens" ("id" SERIAL NOT NULL, "token_hash" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_used_at" TIMESTAMP WITH TIME ZONE, "owner_id" integer NOT NULL, CONSTRAINT "UQ_08addec2b824fc70d89c9da9e40" UNIQUE ("token_hash"), CONSTRAINT "UQ_3abb1325320b55960ef784d2802" UNIQUE ("owner_id"), CONSTRAINT "PK_3251d28fcedb84c470ff0ad639d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "boards" ADD "project" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "refined_prompt" text`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "changes_requested" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "approved_prompt" text`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "prompt_approved_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "ai_branch" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "ai_error" text`);
        await queryRunner.query(`ALTER TABLE "comments" ADD "from_runner" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`DROP INDEX "public"."IDX_32c344d872e5f545fcdb5a2f31"`);
        await queryRunner.query(`ALTER TYPE "public"."tasks_status_enum" ADD VALUE 'prompt_review'`);
        await queryRunner.query(`ALTER TYPE "public"."tasks_status_enum" ADD VALUE 'ai_review'`);
        await queryRunner.query(`CREATE INDEX "IDX_32c344d872e5f545fcdb5a2f31" ON "tasks"  ("board_id", "status", "position") `);
        await queryRunner.query(`ALTER TABLE "runner_tokens" ADD CONSTRAINT "FK_3abb1325320b55960ef784d2802" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "runner_tokens" DROP CONSTRAINT "FK_3abb1325320b55960ef784d2802"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_32c344d872e5f545fcdb5a2f31"`);
        await queryRunner.query(`CREATE TYPE "public"."tasks_status_enum_old" AS ENUM('todo', 'in_progress', 'done')`);
        await queryRunner.query(`ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "public"."tasks_status_enum_old" USING "status"::"text"::"public"."tasks_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."tasks_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."tasks_status_enum_old" RENAME TO "tasks_status_enum"`);
        await queryRunner.query(`CREATE INDEX "IDX_32c344d872e5f545fcdb5a2f31" ON "tasks" USING btree ("board_id", "position", "status") `);
        await queryRunner.query(`ALTER TABLE "comments" DROP COLUMN "from_runner"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "ai_error"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "ai_branch"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "prompt_approved_at"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "approved_prompt"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "changes_requested"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "refined_prompt"`);
        await queryRunner.query(`ALTER TABLE "boards" DROP COLUMN "project"`);
        await queryRunner.query(`DROP TABLE "runner_tokens"`);
    }

}
