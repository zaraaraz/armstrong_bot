import {
  MySqlContainer,
  type StartedMySqlContainer,
} from '@testcontainers/mysql';
import { RedisContainer } from '@testcontainers/redis';
import { execSync } from 'child_process';

export interface TestInfraHandles {
  readonly mysqlUrl: string;
  readonly redisUrl: string;
  stop(): Promise<void>;
}

export async function startTestInfra(): Promise<TestInfraHandles> {
  const [mysql, redis] = await Promise.all([
    new MySqlContainer('mysql:8.0')
      .withDatabase('armstrong_test')
      .withRootPassword('test')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  const mysqlUrl = buildMysqlUrl(mysql);
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  // Set DATABASE_URL for prisma migrate deploy and any subsequent PrismaClient instantiation.
  process.env['DATABASE_URL'] = mysqlUrl;

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: mysqlUrl },
    stdio: 'pipe',
  });

  return {
    mysqlUrl,
    redisUrl,
    async stop() {
      await Promise.all([mysql.stop(), redis.stop()]);
    },
  };
}

export async function truncateAll(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  // DATABASE_URL is already set by startTestInfra()
  const prisma = new PrismaClient();

  try {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
    const tables = await prisma.$queryRaw<{ TABLE_NAME: string }[]>`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
    `;
    for (const { TABLE_NAME } of tables) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${TABLE_NAME}\``);
    }
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
  } finally {
    await prisma.$disconnect();
  }
}

function buildMysqlUrl(container: StartedMySqlContainer): string {
  return `mysql://root:test@${container.getHost()}:${container.getMappedPort(3306)}/armstrong_test`;
}
