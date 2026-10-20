# Multi-stage build for C++ compiler, Node frontend, and Python backend
FROM ubuntu:22.04 AS base

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Build C++ Compiler
COPY compiler/ compiler/
RUN cmake -S compiler -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --parallel

# 2. Install Backend Dependencies
COPY backend/ backend/
RUN python3 -m venv .venv \
    && .venv/bin/pip install --no-cache-dir -r backend/requirements.txt

# 3. Build Next.js Frontend
COPY frontend/ frontend/
WORKDIR /app/frontend
RUN npm ci && npm run build
WORKDIR /app

# 4. Copy Examples, Scripts, and Runtime Config
COPY examples/ examples/
COPY scripts/ scripts/

ENV MINIPTX_COMPILER=/app/build/miniptx
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000 8000

CMD [".venv/bin/python", "scripts/dev.py", "--production"]
