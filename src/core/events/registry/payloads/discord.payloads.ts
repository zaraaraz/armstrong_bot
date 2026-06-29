export interface DiscordMemberJoinedPayload {
  readonly userId: string;
  readonly username: string;
  readonly joinedAt: string;
  readonly isBot: boolean;
}

export interface DiscordMessageDeletedPayload {
  readonly messageId: string;
  readonly channelId: string;
  readonly authorId: string | null;
  readonly contentHash: string | null;
}

export interface DiscordEventPayloads {
  'discord.member.joined': DiscordMemberJoinedPayload;
  'discord.message.deleted': DiscordMessageDeletedPayload;
}
