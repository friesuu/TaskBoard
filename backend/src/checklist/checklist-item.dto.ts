import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Adding an item: just its text
@InputType('ChecklistItemInput')
export class ChecklistItemDto {
  @Field()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  text: string;
}

// Changing an item: new text, ticked/unticked, or both
@InputType('UpdateChecklistItemInput')
export class UpdateChecklistItemDto {
  @Field(() => String, { nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  text?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  done?: boolean;
}
