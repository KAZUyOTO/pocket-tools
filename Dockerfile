# Pocket-Tools — one image with Node + every conversion binary.
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
      poppler-utils \
      inkscape \
      assimp-utils \
      fontforge \
      tesseract-ocr tesseract-ocr-eng \
      wkhtmltopdf \
      potrace \
      p7zip-full \
      libvips-tools \
      python3 python3-pip \
      fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Python engines: PDF -> editable DOCX/XLSX, and the GFPGAN client (which calls
# a hosted Space over the network, so NO local torch/model is bundled).
RUN pip3 install --break-system-packages --no-cache-dir pdf2docx pdfplumber openpyxl gradio_client pillow

# Debian's ImageMagick blocks PDF/PS by default; Pocket-Tools's whole job is
# converting these, so allow them. (Inputs run sandboxed per job with a timeout.)
RUN for p in /etc/ImageMagick-6/policy.xml /etc/ImageMagick-7/policy.xml; do \
      [ -f "$p" ] && sed -i -E 's/rights="none" pattern="(PDF|PS|EPS|XPS)"/rights="read|write" pattern="\1"/' "$p" || true; \
    done

# Raster->SVG uses potrace (B&W) by default. For colour tracing, add vtracer:
#   RUN cargo install vtracer   (needs the Rust toolchain in the image)

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
