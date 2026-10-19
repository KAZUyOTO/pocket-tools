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
- **Engines:** Calibre (ebooks), Inkscape (vector), 7-Zip (archives), Assimp (3D), headless Chrome (url → pdf).
- **Fidelity:** bundled fonts, LibreOffice tuning, GPU transcode for video.
- **Batch jobs & webhooks**, matching the import → convert → export task-chain model.

## License

MIT. Note the bundled binaries carry their own licenses — Ghostscript is AGPL; if you redistribute, keep it behind a process boundary or get its commercial license.
