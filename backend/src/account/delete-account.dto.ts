import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType('DeleteAccountInput')
export class DeleteAccountDto {
  // The current password, asked again before anything is deleted
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
