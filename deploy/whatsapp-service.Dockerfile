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
RUN npm --workspace @elevazap/whatsapp-service run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

RUN apt-get update \
  && apt-get install --no-install-recommends -y ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 1001 app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/whatsapp-service/dist ./whatsapp-service/dist
COPY --from=builder --chown=app:app /app/whatsapp-service/package.json ./whatsapp-service/package.json

USER app
EXPOSE 3001
CMD ["node", "whatsapp-service/dist/index.js"]
