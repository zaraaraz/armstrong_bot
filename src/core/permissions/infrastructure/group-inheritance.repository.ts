import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class GroupInheritanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async addInheritance(
    guildId: string,
    childGroupId: string,
    parentGroupId: string,
  ): Promise<void> {
    await this.prisma['groupInheritance'].upsert({
      where: { childGroupId_parentGroupId: { childGroupId, parentGroupId } },
      update: {},
      create: { guildId, childGroupId, parentGroupId },
    });
  }
}
