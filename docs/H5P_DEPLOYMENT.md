# H5P Interactive EPUB — Deployment Guide

This module integrates [@lumieducation/h5p-server](https://github.com/Lumieducation/H5P-Nodejs-library) and [@lumieducation/h5p-express](https://www.npmjs.com/package/@lumieducation/h5p-express) into the existing PDF→EPUB platform.

## Architecture

| Layer | Path |
|--------|------|
| REST API | `GET/POST/PUT/DELETE /h5p/content`, `/h5p/libraries`, `/h5p/content-types` |
| H5P AJAX (editor client) | `/h5p/ajax/*` |
| Static H5P core | `/h5p/core/*`, `/h5p/editor/*` |
| Frontend proxy | Vite `/api` → backend (calls `/api/h5p/...`) |
| Interactive editor | `/interactive/editor/:bookId` |
| MySQL | `h5p_contents`, `h5p_assets`, `interactive_blocks.h5p_content_id` |

## 1. Database

Run migration or rely on server bootstrap:

```bash
mysql -u USER -p DATABASE < backend/database/migrations/015_h5p_integration.sql
```

Standalone reference: `backend/database/h5p_schema.sql`

## 2. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

Packages added:

- `@lumieducation/h5p-server`
- `@lumieducation/h5p-express`
- `express-fileupload`
- `@lumieducation/h5p-react` (frontend)
- `@mui/material`, `@emotion/react`, `@emotion/styled`

## 3. H5P core & editor client files (required)

The Node library does **not** bundle browser core files. Download and extract:

1. [H5P Core](https://github.com/h5p/h5p-php-library/archive/master.zip) → `backend/h5p/core/`
2. [H5P Editor](https://github.com/h5p/h5p-editor-php-library/archive/master.zip) → `backend/h5p/editor/`

Verify:

```bash
curl http://localhost:8082/h5p/setup-status -H "Authorization: Bearer TOKEN"
```

## 4. Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `H5P_BASE_PATH` | `backend/h5p` | Libraries, content, config storage |
| `H5P_PUBLIC_URL` | `http://localhost:3000/api/h5p` (dev) | Full public URL for H5P core/editor scripts and AJAX (must match how the browser reaches `/h5p` on the API) |
| `PORT` | `3667` / `8082` | Backend port |

Production nginx example:

```nginx
location /api/h5p/ {
  proxy_pass http://127.0.0.1:8082/h5p/;
  proxy_read_timeout 300s;
  client_max_body_size 500m;
}
```

## 5. Install H5P content type libraries

After first start, use library admin routes or upload `.h5p` packages via Hub:

- `POST /h5p/libraries-admin/...` (authenticated, `interactive.content` feature)

Curated types (see `backend/src/config/h5pContentTypes.js`):

- Assessment: MultiChoice, TrueFalse, Blanks (Fill in the Blanks), DragText, MarkTheWords, Essay
- Media: InteractiveVideo, CoursePresentation, ImageHotspots, ImageSequencing
- Games: MemoryGame, Crossword, ImageMultipleHotspotQuestion
- Learning: Flashcards, Accordion, Timeline, BranchingScenario

## 6. Security

- All `/h5p/*` routes require JWT + `interactive.content` plan feature.
- Content rows are scoped by `organization_id` and `created_by_user_id`.
- H5P AJAX uses mapped `req.user` (id/name/email) — never expose library admin to anonymous users.
- File uploads limited by `maxTotalSize` in `backend/h5p/config.json` (default 500MB).
- Run virus scanning in production (`@lumieducation/h5p-clamav-scanner` optional).

## 7. Fixed-layout vs reflow books

Set book metadata when creating/updating a book:

```json
{ "layoutMode": "fixed" }
```

H5P blocks on fixed-layout books prompt for `x`, `y`, `width`, `height`, `zIndex` (stored in `interactive_blocks.layout_json`).

## 8. EPUB export

Export from Interactive Books dashboard or `POST /interactive/books/:id/export/epub`.

H5P blocks are packaged under `OEBPS/h5p/` (CSS, JS, content JSON). Readers without JavaScript receive `<noscript>` fallback text.

**Compatibility:** Full H5P requires the platform web reader. Kindle / Apple Books show static fallbacks.

## 9. Maintenance cron

The server runs cleanup every 5 minutes (`temporaryFileManager.cleanUp`, `contentTypeCache.updateIfNecessary`). For multi-instance deployments, run a single cron worker instead:

```javascript
import { runH5pMaintenance } from './src/services/h5p/h5pService.js';
await runH5pMaintenance();
```

## 10. Production checklist

- [ ] MySQL migration applied
- [ ] `backend/h5p/core` and `backend/h5p/editor` present
- [ ] Writable `backend/h5p/{libraries,content,temporary-storage}`
- [ ] CORS allows frontend origin (`server.js` `allowedOrigins`)
- [ ] `H5P_PUBLIC_URL` matches reverse-proxy path
- [ ] Plan feature `interactive.content` enabled for tenants
- [ ] EPUB export tested with `interactiveEpub: true`

## API reference (frontend uses `/api` prefix in dev)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/h5p/libraries` | Installed H5P libraries |
| GET | `/h5p/content-types` | Curated catalog + hub status |
| POST | `/h5p/content` | Create content |
| GET | `/h5p/content/:id` | Get by DB id or H5P id |
| PUT | `/h5p/content/:id` | Update |
| DELETE | `/h5p/content/:id` | Delete |
| GET | `/h5p/editor/:contentId/model` | Editor model for web component |
| GET | `/h5p/player/:contentId/model` | Player model |

Interactive blocks: `POST /interactive/chapters/:chapterId/blocks` with `type: "h5p"`, `h5pContentId`, `layoutJson`.

Duplicate: `POST /interactive/blocks/:blockId/duplicate`
