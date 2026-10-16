import { Field, InputType } from "@nestjs/graphql";
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

@InputType('ChangePasswordInput')
export class ChangePasswordDto
{
    // Asked again even though you're logged in: someone at your unlocked computer
    // shouldn't be able to take over the account by changing the password.
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    currentPassword: string;

    // Same rules as when registering
    @Field()
    @MinLength(8)
    @MaxLength(128)
    newPassword: string;
}
