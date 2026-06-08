# syntax=docker/dockerfile:1.7

FROM node:22-slim AS deps

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev && npm cache clean --force

FROM node:22-slim AS model

WORKDIR /app

ARG DOWNLOAD_MODEL=false
ARG MODEL_PRECISION=fp16
ARG MODEL_ID=openai/privacy-filter

ENV NODE_ENV=production \
    HF_HUB_DISABLE_XET=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    MODEL_ID=${MODEL_ID} \
    MODEL_PRECISION=${MODEL_PRECISION} \
    LOCAL_MODEL_ROOT=/app/models

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY scripts ./scripts

RUN if [ "${DOWNLOAD_MODEL}" = "true" ]; then \
      apt-get update && \
      apt-get install -y --no-install-recommends ca-certificates python3 python3-pip && \
      rm -rf /var/lib/apt/lists/* && \
      npm run download:model -- "${MODEL_PRECISION}"; \
    else \
      mkdir -p /app/models; \
    fi

FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MODEL_ID=openai/privacy-filter \
    LOCAL_MODEL_ROOT=/app/models \
    LOCAL_FILES_ONLY=true \
    TRANSFORMERS_DTYPE=fp16 \
    TRANSFORMERS_CACHE=/app/.cache/transformers

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=model /app/models ./models
COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/.cache/transformers /app/models && \
    chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
