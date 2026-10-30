-- AddBoards1792125187609: the statements of ../backend/src/migrations/1792125187609-AddBoards.ts, as TypeORM runs them
CREATE TABLE "boards" ("id" SERIAL NOT NULL, "name" character varying(100) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "owner_id" integer NOT NULL, CONSTRAINT "PK_606923b0b068ef262dfdcd18f44" PRIMARY KEY ("id"));
INSERT INTO "boards" ("name", "owner_id") SELECT 'My board', "id" FROM "users";
ALTER TABLE "tasks" ADD "board_id" integer;
UPDATE "tasks" t SET "board_id" = b."id" FROM "boards" b WHERE b."owner_id" = t."owner_id";
ALTER TABLE "tasks" ALTER COLUMN "board_id" SET NOT NULL;
CREATE INDEX "IDX_32c344d872e5f545fcdb5a2f31" ON "tasks"  ("board_id", "status", "position") ;
ALTER TABLE "boards" ADD CONSTRAINT "FK_a20a7418b96eda28e1318408472" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "tasks" ADD CONSTRAINT "FK_2680b7f3ecd70b05030ce6b4aef" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
