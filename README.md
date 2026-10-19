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

```bash
npm install
npm start
# open http://localhost:3000
```

Only the binaries present on your machine are enabled; the rest are greyed out in the UI. To cover everything, install: `ffmpeg imagemagick libreoffice pandoc calibre ghostscript inkscape p7zip-full libvips-tools`.

## What it converts today

| Family | Engine | Examples |
| --- | --- | --- |
| Images | ImageMagick | png, jpg, webp, gif, bmp, tiff, avif |
| Audio / video | FFmpeg | mp4, mov, webm, mkv → mp3, wav, flac, ogg (and video→audio) |
| Documents | LibreOffice | docx, xlsx, pptx, odt, html, txt, csv ↔ pdf |
| Markup | Pandoc | md, rst, html, tex, epub, docx |

The live list is always at `GET /api/formats` and drives the UI dropdown.

## API

```
GET  /api/formats            # supported conversions + engine status
POST /api/convert?to=<ext>   # multipart file upload -> { id, status, ... } (202)
GET  /api/jobs/:id           # poll status: queued | processing | done | error
GET  /api/jobs/:id/download  # the converted file, once done
GET  /api/health             # liveness + queue stats
```

Example:

```bash
ID=$(curl -s -F "file=@report.docx" "localhost:3000/api/convert?to=pdf" | jq -r .id)
# poll until done, then:
curl -s "localhost:3000/api/jobs/$ID/download" -o report.pdf
```

## How it works

```
client → Fastify API → in-process queue → worker → engine (binary) → file back
```

- **Engines** (`src/engines.js`) — each wraps one binary and declares which `from → to` pairs it handles. `resolveEngine()` picks the first that fits. Adding a format is a one-line set change or a new engine object.
- **Jobs** (`src/jobs.js`) — a `Map` + a worker pool bounded by `CONCURRENCY`. Files live under `storage/<jobId>/` and are deleted after `RETENTION_MS`. No database.
- **Safety** — binaries are run with an argv array (never a shell string), each job gets an isolated temp dir, and every conversion has a hard timeout.

## Configuration (env vars)

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `CONCURRENCY` | `2` | conversions running at once |
| `MAX_FILE_SIZE` | `1073741824` | max upload (bytes) |
| `JOB_TIMEOUT_MS` | `300000` | kill a job after this long |
| `RETENTION_MS` | `3600000` | delete files this long after finishing |
| `STORAGE_DIR` | `./storage` | where job files live |

## Roadmap

- **Queue:** swap the in-process pool for Redis + BullMQ (multi-process, survives restarts) — only `src/jobs.js` changes.
- **Engines:** Calibre (ebooks), Inkscape (vector), 7-Zip (archives), Assimp (3D), headless Chrome (url → pdf).
- **Fidelity:** bundled fonts, LibreOffice tuning, GPU transcode for video.
- **Batch jobs & webhooks**, matching the import → convert → export task-chain model.

## License

MIT. Note the bundled binaries carry their own licenses — Ghostscript is AGPL; if you redistribute, keep it behind a process boundary or get its commercial license.
