import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as typeof globalThis & {
    prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
    const pool = new Pool({
        connectionString:
            process.env.DATABASE_URL ||
            "postgresql://axd:axd_dev@localhost:5432/axd?schema=public",
    });

    const adapter = new PrismaPg(pool);

    return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
