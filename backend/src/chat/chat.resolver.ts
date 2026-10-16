import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { ChatMessage } from './chat-message.entity';
import { ChatService } from './chat.service';
import { SendChatMessageDto } from './send-chat-message.dto';

@UseGuards(GqlAuthGuard) // every chat operation needs a login
@Resolver(() => ChatMessage)
export class ChatResolver {
  constructor(private readonly chatService: ChatService) {}

  @Query(() => [ChatMessage])
  chatMessages(@CurrentUser() user: User): Promise<ChatMessage[]> {
    return this.chatService.history(user.id);
  }

  @Mutation(() => ChatMessage)
  sendChatMessage(@CurrentUser() user: User, @Args('input') input: SendChatMessageDto): Promise<ChatMessage> {
    return this.chatService.send(user.id, input.message);
  }

  @Mutation(() => Boolean)
  async clearChat(@CurrentUser() user: User): Promise<boolean> {
    await this.chatService.clear(user.id);
    return true;
  }
}