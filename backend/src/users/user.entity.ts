import { Field, Int, ObjectType } from "@nestjs/graphql";
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@ObjectType()
@Entity('users')
export class User {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  @Field()
  @Column({ unique: true }) // Databse refuses two accounts with the same email (unique: true)
  email: string;

  @Column({ name: 'password_hash' }) // No @Field here because it exists in the database but not in the API
  passwordHash: string;

  // Goes up by 1 every time the password changes. Each login token remembers the number it was
  // made with, so tokens made before a password change stop working (other devices get logged out).
  // No @Field: the API never shows it.
  @Column({ name: 'token_version', type: 'int', default: 0 })
  tokenVersion: number;

  // The user's time zone, e.g. "Asia/Kuala_Lumpur" (sent by their browser). Decides what "today"
  // and "this week" mean in the due-date filters. null until the browser has sent it: then UTC is used.
  @Field(() => String, { nullable: true })
  @Column({ name: 'time_zone', type: 'varchar', length: 64, nullable: true })
  timeZone: string | null;

  // The name shown instead of the email (profile, menu, comments), e.g. "Sam Lee". null = not set: the email is shown.
  @Field(() => String, { nullable: true })
  @Column({ name: 'display_name', type: 'varchar', length: 50, nullable: true })
  displayName: string | null;
}
