import { InputType, OmitType, PartialType } from "@nestjs/graphql";
import { CreateTaskDto } from "./create-task.dto";

// Every create field is optional when updating, except boardId, which can't be changed here
// (moving a task to another board isn't a feature yet).
@InputType('UpdateTaskInput')
export class UpdateTaskDto extends PartialType(OmitType(CreateTaskDto, ['boardId'] as const)) {}
