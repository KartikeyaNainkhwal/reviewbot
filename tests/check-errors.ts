import { prisma } from '../src/db/client.js';
async function main() {
    const rev = await prisma.review.findMany({ select: { id: true, status: true, errorMessage: true } });
    console.dir(rev, { depth: null });
}
main().finally(() => prisma.$disconnect());
