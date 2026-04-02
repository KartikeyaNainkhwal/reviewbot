FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Generate Prisma client
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Production image ───────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy built app and Prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY prisma.config.ts ./

ENV NODE_ENV=production
EXPOSE 3000

# Run migrations and start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
