FROM node:lts-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/openclaw/package.json packages/adapters/openclaw/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
RUN pnpm install --no-frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @paperclipai/ui build
RUN pnpm --filter @paperclipai/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
WORKDIR /app
COPY --from=build /app /app
RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest \
  && curl -fsSL https://railway.com/install.sh | sh

RUN groupadd -r paperclip && useradd -r -g paperclip -d /paperclip -s /bin/bash paperclip \
  && mkdir -p /paperclip && chown -R paperclip:paperclip /paperclip /app

ENV NODE_ENV=production \
  HOME=/paperclip \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default \
  PAPERCLIP_CONFIG=/paperclip/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private

EXPOSE 3100

COPY <<'ENTRYPOINT' /usr/local/bin/entrypoint.sh
#!/bin/bash
chown -R paperclip:paperclip /paperclip

# Auto-clone project workspaces if missing
clone_if_missing() {
  local dir="$1" repo="$2"
  if [ ! -d "$dir/.git" ] && [ -n "$repo" ] && [ -n "$GITHUB_TOKEN" ]; then
    local auth_url="${repo/https:\/\//https:\/\/x-access-token:${GITHUB_TOKEN}@}"
    echo "[entrypoint] Cloning $repo into $dir"
    gosu paperclip git clone "$auth_url" "$dir" 2>&1 || echo "[entrypoint] Clone failed for $repo"
  fi
}
clone_if_missing "/paperclip/instances/default/workspace/classtap/checkin-app" "https://github.com/zackdesign/checkin-app.git"
clone_if_missing "/paperclip/instances/default/workspace/trading-co/trading-bot" "https://github.com/zackdesign/trading-bot.git"

exec gosu paperclip "$@"
ENTRYPOINT
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/* \
  && chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
