FROM node:22-bookworm

ENV NITRO_HOST=0.0.0.0
ENV HOST=0.0.0.0
ENV NITRO_PRESET=node-server

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

CMD ["sh", "-c", "export PORT=\"${PORT:-3000}\"; export NITRO_PORT=\"${PORT}\"; export NITRO_HOST=0.0.0.0; export HOST=0.0.0.0; exec node .output/server/index.mjs"]
