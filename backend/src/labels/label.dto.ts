import { Field, InputType, Int, PartialType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { LabelColor } from './label-color.enum';

// Creating a label: a name and one of the palette colours
@InputType('LabelInput')
export class LabelDto {
  @Field()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  name: string;

  @Field(() => LabelColor)
  @IsEnum(LabelColor)
  color: LabelColor;
}

// Renaming and/or recolouring: both optional
@InputType('UpdateLabelInput')
export class UpdateLabelDto extends PartialType(LabelDto) {}

// The labels a task should have from now on (replaces the old set; [] removes them all)
@InputType('SetTaskLabelsInput')
export class SetTaskLabelsDto {
  @Field(() => [Int])
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  labelIds: number[];
}

// Data Transfer Object is basically like a container used to transfer objects or data
// Main use is to group multiple data/info into a single object
// It hides sensitive database fields
// Decouples frontend from database. If a column changes in the database, the frontend won't break. 
// We can map the new database column name to the old DTO name