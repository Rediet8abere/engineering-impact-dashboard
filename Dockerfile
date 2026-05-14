# Dependencies + build
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm install

COPY server ./server
COPY web ./web

RUN npm run build

# Runtime: one process — API + static `web/dist`
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app .

EXPOSE 4000
CMD ["node", "server/dist/index.js"]
