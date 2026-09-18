FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY whatsapp-service/package.json whatsapp-service/package.json
COPY packages/affiliate-links/package.json packages/affiliate-links/package.json
RUN npm ci

FROM dependencies AS builder

WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm --workspace @elevazap/web run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN useradd --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nextjs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nextjs /app/web/public ./web/public

USER nextjs
EXPOSE 3000
CMD ["node", "web/server.js"]
