import { Field, InputType } from '@nestjs/graphql';
import { IsTimeZone } from 'class-validator';

@InputType('TimeZoneInput')
export class TimeZoneDto {
  // A real IANA time zone name, e.g. "Asia/Kuala_Lumpur" (IsTimeZone checks it exists)
  @Field()
  @IsTimeZone()
  timeZone: string;
}
