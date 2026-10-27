import { Field, Int, ObjectType } from '@nestjs/graphql';

// The numbers on the profile page, counted across all of a user's boards.
// Not a database table: TasksService.stats() counts them in one query.
@ObjectType()
export class TaskStats {
  @Field(() => Int)
  total: number;

  @Field(() => Int)
  todo: number;

  @Field(() => Int)
  promptReview: number;

  @Field(() => Int)
  inProgress: number;

  @Field(() => Int)
  aiReview: number;

  @Field(() => Int)
  done: number;

  // Due before today and not done
  @Field(() => Int)
  overdue: number;

  // Due this week (Monday to Sunday, the user's week) and not done yet
  @Field(() => Int)
  dueThisWeek: number;

  // Moved into Done this week
  @Field(() => Int)
  doneThisWeek: number;
}
