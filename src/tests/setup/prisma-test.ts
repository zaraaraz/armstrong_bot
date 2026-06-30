import { PrismaClient } from '@prisma/client';

/**
 * Creates a PrismaClient reading DATABASE_URL from the environment.
 * Caller must set process.env.DATABASE_URL before calling this.
 */
export function createTestPrisma(): PrismaClient {
  return new PrismaClient();
}
