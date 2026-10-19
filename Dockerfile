# OpenConvert — one image with Node + every conversion binary.
# Big on purpose: LibreOffice + fonts dominate the size (~1.5 GB). That is the
# cost of covering office formats well. Trim the apt list to shrink it.

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      imagemagick \
      libreoffice \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      pandoc \
      calibre \
      ghostscript \
      inkscape \
      p7zip-full \
      libvips-tools \
      fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STORAGE_DIR=/data

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "src/server.js"]
