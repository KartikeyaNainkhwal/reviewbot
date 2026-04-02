import { prisma } from '../src/db/client.js';
async function main() {
  const i = await prisma.installation.count();
  const r = await prisma.repository.count();
  const rev = await prisma.review.findMany({ select: { id: true, status: true, prNumber: true } });
  console.log('Installations:', i);
  console.log('Repositories:', r);
  console.log('Reviews:', rev);
}
main().finally(() => prisma.$disconnect());
