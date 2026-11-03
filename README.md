# Arabidraw

A self-hosted [Excalidraw](https://github.com/excalidraw/excalidraw) fork with Qomra Arabic fonts, presentation mode, and a server-backed drawing gallery.

## Run with Docker

```sh
docker compose up -d --build
```

Open `http://localhost:3000`. Drawings are standard `.excalidraw` files in `./drawings`, mounted at `/data/drawings` in the API container. **Back up this folder and retain it when rebuilding or updating.** The frontend proxies `/api` to the API; the API has no separately published port.

There is no authentication. Use a trusted private network or put an authenticated reverse proxy in front of the deployment. Server files are not encrypted at rest.

## Pencil stroke width

Select the pencil (**Draw**, shortcut **P**) and choose **Extra thin**, the first option under **Stroke width**, for half the width of **Thin**. The same option is available for other stroked shapes. Existing strokes and the default width are unchanged.

## Saving and loading

The toolbar highlights **Save** as the primary action, with a secondary **New** button beside it. On desktop, the icon-only **Share** button opens sharing and collaboration.

- **Save** or **Ctrl/Cmd+S** saves the current drawing. The first save asks for a name.
- **New** saves the current active draft, then opens a fresh canvas. If the drawing has no saved draft, choose **Save and create new**, **Discard and create new**, or **Cancel**. Discard only removes the unsaved canvas, not saved drawings. A failed save or edits made during saving keep the canvas open; save again or cancel. New canvases start without a saved identity or undo history from the previous drawing.
- **Drawings** opens the gallery. Edit the name and press **Save** to rename/update the active drawing. **Save as copy** creates a separate file.
- **Load** asks before discarding local changes. Images and backgrounds are included.
- **Delete** requires confirmation. Deleting the active saved copy keeps its canvas open, ready to save as a new drawing.
- Clearing the canvas or importing a file detaches the previous server drawing, preventing the next save from accidentally overwriting it.
- Browser autosave remains separate from explicit server saving. The browser restores the canvas and its server identity together, including unsaved edits. After upgrading from the original gallery implementation, load a saved drawing once to establish its identity in the new format.
- If another tab or user changes a saved drawing, an outdated save or delete is rejected. Load the latest version or save your edits as a separate copy.
- Save/load/delete/new is disabled during live collaboration. Requests are limited to 50 MB including embedded images; names are limited to 200 characters.

Gallery previews are loaded on demand, with two concurrent jobs and a cache of 64 thumbnails of up to 240px. Each first preview downloads the saved scene.

## Fork features

Qomra Arabic is available in Light, Regular, Medium, Bold, and Black. Default line spacing is 30% greater than upstream. Loading migrates upstream and the earlier 50% defaults; custom spacing is preserved.

**Alt+P** enters presentation mode on desktop and activates the laser pointer. **Escape** exits. The default dark canvas background is `#0a0a0a`.

Excalidraw+ promotions, sign-in/export integration, paid sidebar tabs, hosted AI, upstream analytics/error reporting, CDN font loading, social links, external help links, and publishing to the upstream library service have been removed. Local library import/export, public library browsing, image/file export, shortcut help, and normal sharing/collaboration remain.

**Sharing dependencies:** normal share links and live collaboration still use the existing configured Excalidraw backends. The Docker services here provide the editor and private drawing storage, not a collaboration server. To host sharing infrastructure yourself, configure `VITE_APP_BACKEND_V2_GET_URL`, `VITE_APP_BACKEND_V2_POST_URL`, `VITE_APP_WS_SERVER_URL`, and `VITE_APP_FIREBASE_CONFIG` before building. Explicit server saves use only this instance's `/api/drawings` endpoint.

## Development

Use Node 20+ and Yarn 1.22.22. Install dependencies with `yarn install`, then run these in separate terminals:

```sh
yarn dev:server
DRAWINGS_API_URL=http://127.0.0.1:3001 yarn start
```

The API defaults to port 3001 and `./drawings`. Override `PORT`, `HOST`, and `DRAWINGS_DIR` as needed. The frontend port is configured with `VITE_APP_PORT`.

## Verification

```sh
yarn test:typecheck
yarn test:app --watch=false
yarn build:server
yarn playwright install chromium
yarn test:drawings
```

The application suite checks editor behavior, including text layout and bindings with the fork's increased line spacing. Run it without `--update`; unrelated editor defaults should not be pinned in broad state snapshots.

`test:drawings` launches its own API and frontend on free localhost ports, creates a fresh browser profile, and stores **all test drawings in a new OS temporary directory**. It never reads or modifies `./drawings` or an existing server. Screenshots and failure artifacts stay in the printed temporary path. To use an installed Chromium browser, set `BROWSER_EXECUTABLE_PATH`.

The suite covers creating, updating, renaming, copying, reloading, unsaved edits, load/delete cancellation, imported scenes, Arabic text and images, backgrounds, network failures, concurrent writers, delayed saves, mobile layout, API validation, and persistence across API restarts.

## License

The upstream Excalidraw code is MIT licensed; see [LICENSE](LICENSE).
