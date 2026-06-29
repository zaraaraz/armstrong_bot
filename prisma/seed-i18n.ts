import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.locale.upsert({
    where: { code: 'pt' },
    update: {},
    create: {
      code: 'pt',
      displayName: 'Português',
      enabled: true,
      isDefault: true,
    },
  });

  await prisma.locale.upsert({
    where: { code: 'en' },
    update: {},
    create: {
      code: 'en',
      displayName: 'English',
      enabled: true,
      isDefault: false,
    },
  });

  console.log('Seeded locales: pt, en');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
