# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS bot
WORKDIR /app

ENV NODE_ENV=production
ENV SHERPA_CHANNEL_HOST=0.0.0.0
ENV SHERPA_CHANNEL_PORT=8787
ENV SHERPA_CHANNEL_PATH=/v1/channel

COPY package.json package-lock.json ./
COPY packages/bot/package.json packages/bot/
COPY packages/contract/package.json packages/contract/
COPY packages/runner/package.json packages/runner/

# prepare → husky: бинаря нет в prod → --ignore-scripts
RUN npm ci --omit=dev --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/contract ./packages/contract
COPY packages/bot ./packages/bot

EXPOSE 8787

CMD ["npm", "run", "start", "-w", "@sherpa/bot"]
