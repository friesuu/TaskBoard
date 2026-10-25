import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

@InputType('DisplayNameInput')
export class DisplayNameDto {
  // Spaces around it are trimmed; an empty name removes it (the email is shown again).
  // No control or invisible formatting characters: they could hide a name or make one look like another.
  @Field()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(50)
  @Matches(/^[^\p{Cc}\p{Cf}]*$/u, { message: "The name can't contain invisible or control characters" })
  displayName: string;
}
