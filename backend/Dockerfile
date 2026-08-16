# The translation backend. It holds the provider credential, verifies who is
# asking, and enforces the per-identity budget, so it is the one piece that
# cannot run on a developer's laptop in production.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY backend ./backend
COPY src ./src

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Listen on every interface, because a container's platform routes to it from
# outside; the development default stays loopback.
ENV LAYOUT_TRANSLATE_BIND_HOST=0.0.0.0
ENV LAYOUT_TRANSLATE_MOCK_PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/backend ./backend
COPY --from=build /app/src ./src

# Not root: a process that only needs to make outbound HTTPS calls does not need
# to be able to write to its own image.
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.LAYOUT_TRANSLATE_MOCK_PORT || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "node_modules/tsx/dist/cli.mjs", "backend/src/mock-server.ts"]
