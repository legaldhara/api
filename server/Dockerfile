# Stage 1: Build TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

# ---------------------------
# 1. Install server deps
# ---------------------------
COPY package*.json ./
RUN npm install

# ---------------------------
# 2. Copy sources (including pg-sdk-node with dist)
# ---------------------------
COPY tsconfig.json ./
COPY prisma ./prisma/
COPY src ./src/
COPY src/libs/pg-sdk-node ./src/libs/pg-sdk-node

# Prisma + Build
RUN npx prisma generate
RUN npm run build


# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# ---------------------------
# 1. Install production deps
# ---------------------------
COPY package*.json ./
RUN npm install --omit=dev

# ---------------------------
# 2. Copy build + prisma + SDK
# ---------------------------
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# include dist + types
COPY src/libs/pg-sdk-node ./src/libs/pg-sdk-node

ENV NODE_ENV=production

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
