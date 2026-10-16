import { Args, Int, Mutation, Query, Resolver } from "@nestjs/graphql";
import { TasksService } from "./tasks.service";
import { Task } from "./task.entity";
import { CreateTaskDto } from "./create-task.dto";
import { UpdateTaskDto } from "./update-task.dto";
import { MoveTaskDto } from "./move-task.dto";
import { GqlAuthGuard } from "../auth/gql-auth.guard";
import { UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { User } from "../users/user.entity";

@UseGuards(GqlAuthGuard) // Uses the gql auth guard
@Resolver(() => Task)
export class TaskResolver
{
    constructor(private readonly tasksService: TasksService){}
    @Query(() => [Task], { name: 'tasks'})
    findAll(@CurrentUser() user: User, @Args('boardId', { type: () => Int }) boardId: number): Promise<Task[]> {
        return this.tasksService.findAll(user.id, boardId);
    }
    
    @Mutation(() => Task)
    createTask(@Args( 'input') input: CreateTaskDto, @CurrentUser() user: User): Promise<Task>
    {
        return this.tasksService.create(input, user.id);
    }

    @Mutation(() => Task) // What client will receive from after the database operation is done (Task object with id, title and status)
    updateTask(
        @Args('id', { type: () => Int}) id: number,
        @Args('input') input: UpdateTaskDto,
        @CurrentUser() user: User
    ): Promise<Task>{
        return this.tasksService.update(id, input, user.id);
    }

    // Drag and drop: put a task at a position in a column (same or different one)
    @Mutation(() => Task)
    moveTask(
        @Args('id', { type: () => Int}) id: number,
        @Args('input') input: MoveTaskDto,
        @CurrentUser() user: User
    ): Promise<Task>{
        return this.tasksService.move(id, input, user.id);
    }

    @Mutation(() => Boolean)
    async deleteTask(@Args('id', { type: () => Int}) id: number, @CurrentUser() user: User):
    Promise<boolean>{
        await this.tasksService.remove(id, user.id);
        return true;
    }
}