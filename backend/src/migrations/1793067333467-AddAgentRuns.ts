import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAgentRuns1793067333467 implements MigrationInterface {
    name = 'AddAgentRuns1793067333467'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "agent_runs" ("id" SERIAL NOT NULL, "task_id" integer NOT NULL, "step" character varying(10) NOT NULL, "result" character varying(40) NOT NULL, "branch" character varying(100), "checks_passed" boolean, "cost_usd" double precision, "error" text, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "finished_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_442f7e0ec4ae860cf17edc57825" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_88acc7e051cc1d638f6bc3dad2" ON "agent_runs"  ("task_id", "finished_at") `);
        await queryRunner.query(`ALTER TABLE "agent_runs" ADD CONSTRAINT "FK_131cc2e5e0b406ea48dc9427149" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "agent_runs" DROP CONSTRAINT "FK_131cc2e5e0b406ea48dc9427149"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_88acc7e051cc1d638f6bc3dad2"`);
        await queryRunner.query(`DROP TABLE "agent_runs"`);
    }

}
