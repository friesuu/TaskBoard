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
}
