# VisionHarness Desktop

The desktop app is the same `web/` UI plus the same Python backend, packaged by
Tauri. There is no second frontend — every UI change lands in the desktop build
the next time you rebuild.

## Layout

| Path | Purpose |
| --- | --- |
| `web/` | Next.js UI. `next build` now exports a static bundle to `web/out`. |
| `web/src-tauri/` | Tauri shell. Starts/stops the backend sidecar with the window. |
| `packaging/visionharness-server.spec` | PyInstaller recipe for the backend binary. |
| `scripts/build_desktop.sh` | Builds sidecar + installers in one command. |

## Build installers

```bash
./scripts/build_desktop.sh
```

Outputs on Windows:

- `web/src-tauri/target/release/bundle/msi/VisionHarness_0.1.0_x64_en-US.msi`
- `web/src-tauri/target/release/bundle/nsis/VisionHarness_0.1.0_x64-setup.exe`

Rebuild only the UI (backend sidecar already built):

```bash
SKIP_BACKEND=1 ./scripts/build_desktop.sh
```

## Develop with hot reload

```bash
# terminal 1 – Python backend
python -m uvicorn visionharness.server:app --port 8000

# terminal 2 – Tauri window pointed at the Next dev server
cd web && npm run tauri dev
```

`tauri dev` runs `npm run dev` for you. The shell reuses a backend that is
already listening on port 8000 instead of starting its own.

## Runtime data

The installed app keeps writable state outside the install directory, in the
Tauri app-data folder (Windows: `%APPDATA%\com.visionharness.desktop`):

```
sessions/   chat history
uploads/    uploaded footage
output/     rendered tracking videos
workflows/  saved workflow specs
.env        optional API keys
```

The sidecar receives this folder as `VISIONHARNESS_DATA_DIR`; a repo checkout
keeps using `./sessions`, `./uploads`, `./output`, `./workflows`.

## API key

The agent needs a Gemini key. For the installed app, create
`%APPDATA%\com.visionharness.desktop\.env`:

```
GEMINI_API_KEY=...
```

For a checkout, the existing root `.env` is used.
