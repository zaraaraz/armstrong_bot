import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { TransactionalClient } from './transaction.context';

@Injectable()
export class PrismaTransactionManager {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    work: (tx: TransactionalClient) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T> {
    return this.prisma.$transaction(work, {
      timeout: options?.timeout ?? 10_000,
      maxWait: options?.maxWait ?? 5_000,
    });
  }
}
