# Coolify builds this from `develop` for the preview environment.
# The image does not migrate. The owner applies migrations with the owner URL.

FROM node:24.22.1-bookworm-slim AS build

WORKDIR /src

# package.json pins pnpm. Corepack downloads that version; the prompt would hang the build.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec nuxi build

FROM node:24.22.1-bookworm-slim AS runtime

WORKDIR /app

# The process can listen and read its own build. It does not own the image layers.
RUN groupadd --system --gid 1001 transferpro \
  && useradd --system --uid 1001 --gid 1001 --home-dir /app --shell /usr/sbin/nologin transferpro

COPY --from=build --chown=transferpro:transferpro /src/.output /app/.output

USER transferpro

# Nitro reads HOST and PORT. 0.0.0.0 is required so the proxy can reach the container.
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# The check is the readiness route. A dead database or a refused role is non-200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node --input-type=module -e "const port=process.env.PORT||'3000'; const res=await fetch('http://127.0.0.1:'+port+'/api/ready'); if (!res.ok) process.exit(1)"

CMD ["node", ".output/server/index.mjs"]
