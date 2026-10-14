# Hire the agent: the slash-agent demo on Cloud Run. Build from the repo root:
#   docker build -f web/Dockerfile -t agent-web .
FROM oven/bun:1-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY web ./web
COPY examples ./examples
USER bun
EXPOSE 8080
CMD ["bun", "web/server.ts"]
