FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/editor/package.json apps/editor/package.json
RUN npm ci --no-audit --no-fund
COPY apps/editor/ apps/editor/
RUN npm run build
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
WORKDIR /app
COPY --from=build --chown=node:node /src/apps/editor/.output/ ./
USER node
ENV HOST=0.0.0.0 PORT=3000 NUXT_PUBLIC_SYNTHETIC_ONLY=false
EXPOSE 3000
CMD ["node", "server/index.mjs"]
