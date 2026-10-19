# OpenConvert

Self-hosted, fully open-source file conversion. Upload a file, pick a format, get it back. Everything runs on your own server — no accounts, no limits, no file leaves the box.

The actual conversions are done by battle-tested open-source binaries (FFmpeg, LibreOffice, ImageMagick, Pandoc). OpenConvert is the thin, hackable layer around them: an API, a job queue, and a drag-and-drop UI.

## Quick start

### With Docker (recommended — bundles every converter)

```bash
docker compose up --build
# open http://localhost:3000
```

### Without Docker (uses whatever binaries you already have)

Needs a Redis instance and two processes — the API and at least one worker:

```bash
npm install
redis-server &            # or point REDIS_URL at an existing Redis
npm run worker &          # one or more workers
npm start                 # the API
# open http://localhost:3000
```

Only the binaries present on your machine are enabled; the rest are greyed out in the UI. To cover everything, install: `ffmpeg imagemagick libreoffice pandoc calibre ghostscript poppler-utils inkscape assimp-utils fontforge tesseract-ocr wkhtmltopdf potrace p7zip-full libvips-tools python3 python3-pip`, then `pip3 install pdf2docx pdfplumber openpyxl` (and `cargo install vtracer` for colour raster→svg).

## What it converts

Eleven engines across every CloudConvert category. With one-hop **chaining** (below) that's ~2,000 reachable conversions.

| Category | Engine | Examples |
| --- | --- | --- |
| Images (raster) | ImageMagick | png, jpg, webp, gif, bmp, tiff, avif, heic, ico, psd → each other, and image → pdf |
| Audio / video | FFmpeg | mp4, mov, webm, mkv, mp3, wav, flac, ogg (video→audio, video↔gif) |
| Documents / sheets / slides | LibreOffice | docx, xlsx, pptx, odt, csv, html, txt ↔ pdf |
| Markup | Pandoc | md, rst, html, tex, epub, docx, org |
| PDF extract | Poppler | pdf → png, jpg, tiff, svg, ps, txt, html |
| Vector | Inkscape | svg, emf, wmf → pdf, eps, ps, png |
| PostScript | Ghostscript | ps, eps ↔ pdf |
| Ebooks | Calibre | epub, mobi, azw3, fb2, lit, pdb ↔ each other, pdf, docx |
| 3D meshes | Assimp | obj, stl, ply, gltf, glb, fbx, dae, 3ds |
| Archives | 7-Zip / tar | zip, 7z, tar, gz, tgz (repack); extracts rar |
| Fonts | FontForge | ttf, otf, woff, woff2 |
| OCR | Tesseract | scanned image → txt (png, jpg, tiff, bmp) |
| Web pages | wkhtmltopdf | a live URL or local html → pdf, png, jpg |
| Vectorize | vtracer / potrace | png, jpg, bmp, gif → svg (raster → vector) |
| PDF → Office | pdf2docx / pdfplumber | pdf → docx (text, tables, images); pdf → xlsx (tables) |

The live list is always at `GET /api/formats` and drives the UI dropdown — only engines whose binary is installed appear.

### Chaining

When no single engine does `from → to` directly, OpenConvert routes through an intermediate (pdf, html, png, …). So `md → pdf` runs `pandoc → libreoffice`, and `svg → jpg` runs `inkscape → poppler`, automatically. The route is shown in each job's `engine` field.

## API

```
GET  /api/formats            # supported conversions + engine status
POST /api/convert?to=<ext>   # multipart file upload -> { id, status, ... } (202)
GET  /api/jobs/:id           # poll status: queued | processing | done | error
GET  /api/jobs/:id/download  # the converted file, once done
GET  /api/health             # liveness + queue stats
```

Example (file):

```bash
ID=$(curl -s -F "file=@report.docx" "localhost:3000/api/convert?to=pdf" | jq -r .id)
# poll until done, then:
curl -s "localhost:3000/api/jobs/$ID/download" -o report.pdf
```

Example (web page → PDF, no file):

```bash
curl -s -X POST "localhost:3000/api/convert?to=pdf&url=https://example.com"
```

> **Note on URL rendering:** the server fetches whatever URL it's given. On a
> public deployment that's an SSRF surface — put it behind auth or an allowlist,
> or disable the URL path, before exposing it to the internet.

## How it works

```
client → Fastify API ──┐                        ┌──→ engine (binary) → file back
                       └→ Redis queue (BullMQ) ──┤
            worker process(es) ─────────────────┘
```

The API and the worker(s) are **separate processes** that share Redis and the `storage/` volume. Jobs survive an API restart (they sit in Redis) and a worker restart (an interrupted job is retried). Scale throughput by running more workers.

- **Engines** (`src/engines.js`) — each wraps one binary and declares which `from → to` pairs it handles. `resolveEngine()` picks the first that fits. Adding a format is a one-line set change or a new engine object.
- **Queue** (`src/queue.js`, `src/jobs.js`) — BullMQ on Redis. The API enqueues; workers consume at `CONCURRENCY` each. Files live under `storage/<jobId>/`.
- **Worker** (`src/worker.js`) — the consumer, plus a restart-proof sweeper that deletes job files older than `RETENTION_MS`.
- **Safety** — binaries are run with an argv array (never a shell string), each job gets an isolated temp dir, and every conversion has a hard timeout.

## Configuration (env vars)

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `CONCURRENCY` | `2` | conversions running at once |
| `MAX_FILE_SIZE` | `1073741824` | max upload (bytes) |
| `JOB_TIMEOUT_MS` | `300000` | kill a job after this long |
| `RETENTION_MS` | `3600000` | delete files this long after finishing |
| `STORAGE_DIR` | `./storage` | where job files live (shared by API + workers) |
| `REDIS_URL` | `redis://127.0.0.1:6379` | queue backend |
| `QUEUE_NAME` | `conversions` | BullMQ queue name |

## Roadmap

- ~~**Queue:** Redis + BullMQ, multi-process, survives restarts.~~ ✅ done (Phase 2)
- ~~**Engines:** Calibre, Inkscape, Ghostscript, Poppler, Assimp, 7-Zip, FontForge + one-hop chaining.~~ ✅ done (Phase 3)
- ~~**OCR** (image → text), **URL/HTML → PDF/PNG** (wkhtmltopdf), **raster → SVG** (vtracer/potrace).~~ ✅ done (Phase 4)
- ~~**PDF → editable Office:** pdf → docx (pdf2docx) and pdf → xlsx (pdfplumber).~~ ✅ done (Phase 5)
- **Higher-fidelity PDF → Office:** optional ML engine (IBM Docling / Marker) — far better on complex layouts, but downloads models and wants more compute. See note below.
- **Engines, more:** CAD (dxf/dwg), RAW photo (LibRaw), subtitles, pdf → pptx.
- **Operations:** OCR scanned pdf → searchable pdf, compress/optimize, merge.

### A note on PDF → Office quality

`pdf2docx` reconstructs text, tables and images from **digital** PDFs well. Two limits to know:

- **Scanned PDFs** have no text layer — run OCR first (the OCR engine, or `ocrmypdf`) or you'll get an empty document.
- **Complex multi-column / heavy layouts** are where open-source tools trail the commercial engines CloudConvert licenses. For those, the best open-source path is an **ML extractor** — [Docling](https://github.com/docling-project/docling) or [Marker](https://github.com/datalab-to/marker) — which you can add as an engine that shells out to `docling input.pdf --to docx`. It's not bundled by default because it pulls multi-GB models and benefits from a GPU.
- **Fidelity:** bundled fonts, LibreOffice tuning, GPU transcode for video.
- **Batch jobs & webhooks**, matching the import → convert → export task-chain model.

## License

MIT. Note the bundled binaries carry their own licenses — Ghostscript is AGPL; if you redistribute, keep it behind a process boundary or get its commercial license.
