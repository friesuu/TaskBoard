import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { Task } from '../tasks/task.entity';
import { TaskComment } from '../comments/task-comment.entity';
import { ChecklistItem } from '../checklist/checklist-item.entity';

// REFINE = write (or revise) the prompt for a task. BUILD = carry out an approved prompt.
// MERGE = merge a built branch you clicked Merge on (no Claude: the runner runs git itself).
export enum RunnerJobKind {
  REFINE = 'refine',
  BUILD = 'build',
  MERGE = 'merge',
}

registerEnumType(RunnerJobKind, { name: 'RunnerJobKind' });

// One piece of work for the runner: which step, on which task, in which project, with everything it needs to read.
// Not a database table: RunnerService puts it together.
@ObjectType()
export class RunnerJob {
  @Field(() => RunnerJobKind)
  kind: RunnerJobKind;

  // The board's project name; the runner finds its folder in projects.json
  @Field()
  project: string;

  @Field(() => Task)
  task: Task;

  // BUILD only: the exact prompt you approved (the only thing the runner may carry out)
  @Field(() => String, { nullable: true })
  approvedPrompt: string | null;

  @Field(() => [TaskComment])
  comments: TaskComment[];

  @Field(() => [ChecklistItem])
  checklist: ChecklistItem[];
}
