-- AddLabels1792323520653: the statements of ../backend/src/migrations/1792323520653-AddLabels.ts, as TypeORM runs them
CREATE TYPE "public"."labels_color_enum" AS ENUM('gray', 'blue', 'purple', 'teal', 'green', 'yellow', 'orange', 'pink');
CREATE TABLE "labels" ("id" SERIAL NOT NULL, "name" character varying(30) NOT NULL, "color" "public"."labels_color_enum" NOT NULL DEFAULT 'gray', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "board_id" integer NOT NULL, CONSTRAINT "PK_c0c4e97f76f1f3a268c7a70b925" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "IDX_2b2cab7d734e3d8c71622e7e79" ON "labels"  ("board_id", "name") ;
CREATE TABLE "task_labels" ("task_id" integer NOT NULL, "label_id" integer NOT NULL, CONSTRAINT "PK_d46d4e476e3f6f8bf272b2bc1eb" PRIMARY KEY ("task_id", "label_id"));
CREATE INDEX "IDX_844df22351eb86c33c3e8c132f" ON "task_labels"  ("task_id") ;
CREATE INDEX "IDX_09dd3f6f9d04063726c498155f" ON "task_labels"  ("label_id") ;
ALTER TABLE "labels" ADD CONSTRAINT "FK_8c01957f89bcb4364bb5b4b35ce" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "task_labels" ADD CONSTRAINT "FK_844df22351eb86c33c3e8c132f4" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_labels" ADD CONSTRAINT "FK_09dd3f6f9d04063726c498155f2" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
