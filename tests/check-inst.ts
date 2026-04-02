import { prisma } from '../src/db/client.js';
async function main() {
    const inst = await prisma.installation.findMany();
    console.dir(inst, { depth: null });
}
main().finally(() => window ? process.exit(0) : setTimeout(() => process.exit(0), 100));
