# Inventory Manager — Frontend

Nuxt 4 frontend for the [inventory-manager](../inventory-manager) API: an inventory dashboard plus a drag-and-drop PDF template designer.

## Stack

- **Nuxt 4** / Vue 3, Composition API
- Plain CSS design system (`app/assets/css/main.css` — tokens + shared `.btn`/`.card`/`.badge` classes), no UI framework dependency
- **Vitest** for unit tests

## Pages

- `/` — product dashboard: list, low-stock badges, create product, record stock movements, download the built-in stock report PDF
- `/templates` — list of saved PDF templates
- `/templates/new` / `/templates/:id` — the template editor: drag/resize elements (text, data field, table, image) on an A4 canvas, a live debounced PDF preview, and a floating properties popup. Browsing and designing work without an account; saving requires logging in (top-right of the toolbar).
- `/login` — optional login/register

## Running locally

```bash
cp .env.example .env
npm install
npm run dev
```

Runs on `http://localhost:3001` by default (see `package.json`'s `dev` script) and expects the backend API at the URL in `.env`'s `NUXT_PUBLIC_API_BASE` (defaults to `http://localhost:3000`).

## Tests

```bash
npm test
```

Unit tests currently cover the template editor's pure layout math (`app/utils/templateEditorMath.ts`) — the canvas auto-fit scaling, the tooltip flip/clamp positioning, and new-element staggering. These specifically regression-test bugs that were caught by hand during development (a double-padding-subtraction bug in the scale calc, a tooltip that could render off the top of the canvas, and new elements all landing on the same default position).

## Notable implementation details

- The editable canvas always fits its wrapper without scrolling by measuring available space via `ResizeObserver` and scaling down (never up) — see `computeCanvasScale`.
- Text/Data-field elements auto-size to their content (matching how the backend's Handlebars compiler renders them) rather than being manually resizable.
- The element properties popup is a floating tooltip anchored to the selected element, not a fixed panel — it flips above/below and clamps horizontally so it never renders off-canvas.
- The PDF preview is rendered server-side from the *in-progress, unsaved* layout (via `POST /reports/preview-pdf`) and displayed via a blob URL — no save required to see it.
- Leaving the editor with unsaved changes (closing the tab or navigating in-app) prompts a confirmation.
