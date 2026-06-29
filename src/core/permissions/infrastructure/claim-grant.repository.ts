import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ClaimGrantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    guildId: string,
    groupId: string,
    claim: string,
    effect: 'GRANT' | 'DENY',
  ): Promise<void> {
    await this.prisma['claimGrant'].upsert({
      where: { groupId_claim: { groupId, claim } },
      update: { effect },
      create: { guildId, groupId, claim, effect },
    });
  }

  async removeGrant(groupId: string, claim: string): Promise<void> {
    await this.prisma['claimGrant'].deleteMany({ where: { groupId, claim } });
  }
}
