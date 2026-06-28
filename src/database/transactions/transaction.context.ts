import type { Prisma } from '@prisma/client';

export type TransactionalClient = Prisma.TransactionClient;

export interface RepositoryContext {
  readonly tx?: TransactionalClient;
}
