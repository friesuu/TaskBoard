import { Field, Float, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import {
  IsBoolean, IsDate, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ----- From you (task panel) -----

// The prompt, after your edits (e.g. blanks filled in)
@InputType('RefinedPromptInput')
export class RefinedPromptDto {
  @Field()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  prompt: string;
}

// "Request changes": what Claude should change in the prompt. Saved as a normal comment.
@InputType('PromptChangesInput')
export class PromptChangesDto {
  @Field()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  comment: string;
}

// ----- From the runner -----

@InputType('RunnerPromptInput')
export class RunnerPromptDto {
  @Field()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  prompt: string;
}

@InputType('RunnerBuildStartInput')
export class RunnerBuildStartDto {
  // Always "ai/task-<id>-<words>": the runner never gets to name main or any other branch
  @Field()
  @IsString()
  @MaxLength(100)
  @Matches(/^ai\/task-\d+(-[a-z0-9]+)*$/, { message: 'branch must look like ai/task-12-short-title' })
  branch: string;
}

@InputType('RunnerBuildResultInput')
export class RunnerBuildResultDto {
  // What changed, which files, build and test results, how to test it (posted as a comment)
  @Field()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  summary: string;
}

@InputType('RunnerErrorInput')
export class RunnerErrorDto {
  @Field()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}

// One finished step, for the task's run log
@InputType('RunnerRunLogInput')
export class RunnerRunLogDto {
  @Field()
  @IsIn(['refine', 'build'])
  step: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  result: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^ai\/task-\d+(-[a-z0-9]+)*$/)
  branch?: string | null;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  checksPassed?: boolean | null;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  costUsd?: number | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  error?: string | null;

  @Field()
  @IsDate()
  startedAt: Date;
}
