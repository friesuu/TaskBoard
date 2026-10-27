import { Field, Float, InputType, Int } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max,
  MaxLength, Min, ValidateNested,
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

// "Reject": what Claude should change in the prompt. Kept in the AI tab (a comment of kind "feedback").
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
  // Did it go fine: Claude finished, the runner's build and test checks passed, nothing was blocked?
  // false shows the task as Failed (it still goes to AI Review, for you to look at).
  @Field()
  @IsBoolean()
  checksPassed: boolean;
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

// ----- The runner's activity: runs, their step-by-step logs, and what it's doing now -----

// The kinds of log line: the runner's own steps, what Claude said, its thinking, the tools it used
// (files read or edited, commands), the runner's build and test checks, and errors
export const LOG_KINDS = ['info', 'claude', 'thinking', 'tool', 'check', 'error'];

// A step starts: the run is opened, so the AI Activity page shows it as running
@InputType('RunnerRunStartInput')
export class RunnerRunStartDto {
  @Field()
  @IsIn(['refine', 'build'])
  step: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^ai\/task-\d+(-[a-z0-9]+)*$/)
  branch?: string | null;
}

@InputType('RunnerLogLineInput')
export class RunnerLogLineDto {
  @Field()
  @IsDate()
  at: Date;

  @Field()
  @IsIn(LOG_KINDS)
  kind: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text: string;
}

// A few lines of a run's log at a time, while it runs
@InputType('RunnerLogInput')
export class RunnerLogInputDto {
  @Field(() => [RunnerLogLineDto])
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RunnerLogLineDto)
  lines: RunnerLogLineDto[];
}

// The step ended
@InputType('RunnerRunFinishInput')
export class RunnerRunFinishDto {
  @Field()
  @IsIn(['succeeded', 'failed'])
  status: string;

  // In a few words: "prompt saved", "built", "stopped early", "usage limit"...
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  result: string;

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

  // Builds: what changed, which files, the checks, how to try it
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  summary?: string | null;
}

// What the runner is doing now: sent on every check, and every 30 seconds while a step runs
@InputType('RunnerStatusInput')
export class RunnerStatusDto {
  @Field()
  @IsIn(['idle', 'working', 'paused', 'unplugged', 'capped'])
  state: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  taskId?: number | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsIn(['refine', 'build'])
  step?: string | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  pausedUntil?: Date | null;
}
