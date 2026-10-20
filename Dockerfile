# Owner-only admin website (static files and a small static server). Build context: the admin/ directory.
# The API origin is read at runtime from ADMIN_API_ORIGIN, so the same image works for any domain.

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY types ./types
RUN npm run build

FROM node:22-alpine AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /src/dist ./dist
COPY server.mjs ./server.mjs
USER node
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["node", "-e", "fetch('http://127.0.0.1:8081/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.mjs"]
