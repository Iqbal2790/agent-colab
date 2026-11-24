# Multi-stage build for Agent Colab (Node.js 22 LTS + Cloudflared)
FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm install
RUN npm run build

FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4242
ENV AGENT_COLAB_VAULT=/data/vault

# Optional: install cloudflared for on-demand public tunnels
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared \
  && chmod +x /usr/local/bin/cloudflared \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web/dist ./apps/web/dist

VOLUME ["/data/vault"]
EXPOSE 4242

CMD ["node", "packages/server/dist/bin.js"]
