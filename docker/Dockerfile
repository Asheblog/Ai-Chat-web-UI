# all-in-one 运行镜像：基于已构建的 backend + frontend 镜像合成
# 本地/CI 用法：
#   docker build -f packages/backend/Dockerfile --target production -t aichat-backend:local .
#   docker build -f packages/frontend/Dockerfile --target runner -t aichat-frontend:local .
#   docker build -f docker/Dockerfile --build-arg BACKEND_IMAGE=aichat-backend:local --build-arg FRONTEND_IMAGE=aichat-frontend:local -t aichat:local .

ARG BACKEND_IMAGE=ghcr.io/asheblog/aichat-backend:latest
ARG FRONTEND_IMAGE=ghcr.io/asheblog/aichat-frontend:latest

FROM ${FRONTEND_IMAGE} AS frontend
FROM ${BACKEND_IMAGE} AS app

USER root

RUN apt-get update && \
    apt-get install -y --no-install-recommends supervisor && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1002 nextjs 2>/dev/null || true && \
    id -u nextjs >/dev/null 2>&1 || useradd --uid 1002 --gid nextjs --system --no-create-home nextjs

# 前端独立目录，避免覆盖 backend 的 /app/node_modules
COPY --from=frontend /app /opt/frontend
RUN mkdir -p /opt/frontend/packages/frontend/.next/cache && \
    chown -R nextjs:nextjs /opt/frontend

COPY docker/supervisord.conf /etc/supervisor/conf.d/aichat.conf
COPY docker/run-as-backend.sh /usr/local/bin/run-as-backend.sh
COPY docker/run-as-frontend.sh /usr/local/bin/run-as-frontend.sh
COPY docker/start-app.sh /usr/local/bin/start-app.sh
RUN chmod +x \
    /usr/local/bin/run-as-backend.sh \
    /usr/local/bin/run-as-frontend.sh \
    /usr/local/bin/start-app.sh

ENV BACKEND_HOST=127.0.0.1
ENV BACKEND_INTERNAL_PORT=8001
ENV NEXT_PUBLIC_API_URL=/api

EXPOSE 3000 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:3000/api/health >/dev/null \
     && curl -fsS http://localhost:8001/api/settings/health >/dev/null \
     || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["/usr/local/bin/start-app.sh"]
