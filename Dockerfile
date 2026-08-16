FROM node:22-bookworm

ENV NITRO_HOST=0.0.0.0
ENV HOST=0.0.0.0
ENV NITRO_PRESET=node-server
ENV NSE_PYTHON_BIN=python3

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY . .
RUN npm run build

EXPOSE 3000

# Railway/container health probe. Uses Node itself so no extra curl/wget
# package is required in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "export PORT=\"${PORT:-3000}\"; export NITRO_PORT=\"${PORT}\"; export NITRO_HOST=0.0.0.0; export HOST=0.0.0.0; exec node .output/server/index.mjs"]
