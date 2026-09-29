# Single-container image: the API serves the built frontend itself.
# Used by railway.json; also fine for Fly/Render/any Docker host.
#   docker build -t brief . && docker run -p 8000:8000 -e DATABASE_URL=... brief
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ .
RUN npm run build

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    FRONTEND_DIST=/app/frontend/dist AUTO_CREATE_TABLES=false
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 curl && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/ .
COPY --from=web /web/dist /app/frontend/dist
RUN chmod +x entrypoint.sh
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:${PORT:-8000}/api/health || exit 1
ENTRYPOINT ["./entrypoint.sh"]
