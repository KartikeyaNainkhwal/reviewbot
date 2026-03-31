import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
    earlyAccess: true,
    schema: path.join(__dirname, 'prisma', 'schema.prisma'),
    migrate: {
        async resolve({ datasourceUrl }) {
            return process.env.DATABASE_URL || 'postgresql://axd:axd_dev@localhost:5432/axd?schema=public';
        },
    },
});
