import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

@InputType('BoardProjectInput')
export class BoardProjectDto {
  // A project NAME from the runner's projects.json, e.g. "notes-app": lowercase letters, digits and dashes.
  // Never a folder path. Empty = no project (the runner leaves the board alone).
  @Field()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MaxLength(50)
  @Matches(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, {
    message: 'Use a project name from the runner, e.g. "notes-app" (letters, digits and dashes)',
  })
  project: string;
}
