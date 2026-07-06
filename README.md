# Puzz

A zero-dependency, configurable web puzzle game. Drop two files into your site, write a JSON config, and you have a working jigsaw puzzle — drag-and-drop, 3D piece flips to reveal descriptions, a timer, and emoji celebrations on completion.

Designed as a generic open-source component: use it as a personal-site conceit, a classroom activity, or any context where "put this together to learn more" adds value.

---

## Features

- **Drag-and-drop** with snap-to-slot and bounce animation
- **Two layout types**: built-in rectangle grid (with piece-count presets), or custom SVG interlocking pieces
- **3D card flip** + full-height info panel — click any piece to open its description
- **Markdown descriptions** — `description` fields support headings, bold, italic, lists, and links
- **Timer** starts on first drag, **pauses** while the info panel is open
- **Escalating emoji celebration** — 5 waves of emojis, growing in count and speed each second; 🏆 mixed in when you beat your fastest time
- **Word-by-word completion overlay** — auto-dismisses after 5 seconds; piece labels fade back in so you can keep exploring
- **Persistent scores** via `localStorage` — tracks fastest time, completion count, history
- Zero dependencies — vanilla JS + CSS, no build step

---

## Quick Start

```bash
cd /path/to/Puzz
python3 -m http.server 8787
# open http://localhost:8787
```

Swap `config.json` and `sample.jpg` with your own content to get started.

---

## Embedding

```html
<div id="puzzle" style="width:100vw; height:100vh;"></div>
<link rel="stylesheet" href="puzz.css">
<script src="puzz.js"></script>
<script>
  new Puzz(document.getElementById('puzzle'), 'config.json').init();
</script>
```

The container element can be any size — Puzz fills it.

---

## Config Reference

```json
{
  "image": "my-photo.jpg",
  "title": "My Puzzle",
  "subtitle": "Drag the pieces into the frame",
  "layout": { "type": "grid", "cols": 3, "rows": 2 },
  "storageKey": "my-puzzle",
  "completionMessage": "You put it all together!",
  "celebrationEmojis": ["🎉","🌟","✨","🎊","🦋","🌈","🔥","💫","🎈","🍀"],
  "pieces": [
    { "id": "p1", "title": "About",   "subtitle": "who I am",    "description": "Long text shown on the back of this piece." },
    { "id": "p2", "title": "Work",    "subtitle": "what I do",   "description": "..." },
    { "id": "p3", "title": "Skills",  "subtitle": "how I do it", "description": "..." },
    { "id": "p4", "title": "Play",    "subtitle": "side quests", "description": "..." },
    { "id": "p5", "title": "Writing", "subtitle": "thoughts",    "description": "..." },
    { "id": "p6", "title": "Contact", "subtitle": "say hello",   "description": "..." }
  ]
}
```

### Top-level fields

| Field | Required | Description |
|---|---|---|
| `image` | ✓ | Path to the background image (jpg, png, webp) |
| `title` | ✓ | Shown in the center of the frame before any pieces are placed |
| `subtitle` | | Smaller instruction text below the title |
| `layout` | | Layout config — see [Layouts](#layouts). Default: `{"type":"grid","cols":3,"rows":2}` |
| `storageKey` | | `localStorage` namespace. Use a unique value per puzzle. Default: `"puzz"` |
| `completionMessage` | | Text overlaid word-by-word when the puzzle is solved |
| `celebrationEmojis` | | Emoji pool for bonus celebrations. Overrides the built-in default list |
| `pieces` | ✓ | One entry per piece, in reading order (left-to-right, top-to-bottom) |

### Piece fields

| Field | Required | Description |
|---|---|---|
| `id` | ✓ | Unique identifier: `"p1"`, `"p2"`, … |
| `title` | ✓ | Shown on the front face of the piece |
| `subtitle` | | Smaller text below the title on the front face |
| `description` | | Content shown in the info panel when the piece is flipped. Supports markdown — see [Markdown in Descriptions](#markdown-in-descriptions). |

---

## Layouts

### Grid layout (built-in)

Divides the image into a uniform rectangle grid. No SVG or extra files needed.

**Explicit cols/rows:**
```json
"layout": { "type": "grid", "cols": 3, "rows": 2 }
```

**Piece-count shorthand** (recommended for common sizes):
```json
"layout": { "type": "grid", "pieces": 9 }
```

| `pieces` value | Grid |
|---|---|
| `4`  | 2 × 2 |
| `6`  | 3 × 2 |
| `9`  | 3 × 3 |
| `15` | 5 × 3 |
| `25` | 5 × 5 |

The `pieces[]` array must have exactly as many entries as the grid has cells.

### Custom SVG layout

Interlocking or irregular piece shapes, defined by SVG paths you draw or generate.

```json
"layout": { "type": "custom", "src": "layouts/my-layout.json" }
```

The layout JSON is generated from an Inkscape SVG — see [Creating Custom Pieces](#creating-custom-pieces) below.

---

## Creating Custom Pieces

Two paths: draw them in Inkscape, or generate them parametrically.

### Option A — Draw in Inkscape

Requirements for the SVG:
- One `<path>` per piece in a single Inkscape layer
- Each path must have an `inkscape:label` attribute that names the piece
- Labels must match the `PIECE_ORDER` list in `bin/extract_layout.py` (edit that list if your labels differ from the default)
- Default label set: `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`
- All paths must be closed (end with `Z`)
- Pieces must fully cover the puzzle area with no gaps between neighbors

Three example SVG files are included in `graphics/` — see [Included Piece Sets](#included-piece-sets).

### Option B — Generate parametric pieces

`bin/generate_jigsaw.py` produces classic round-tab interlocking jigsaw shapes programmatically, with no manual drawing required.

```bash
python3 bin/generate_jigsaw.py graphics/my-pieces.svg
```

The generated SVG is immediately ready for `bin/extract_layout.py`. Shape is controlled by constants at the top of the script:

| Constant | Default | Description |
|---|---|---|
| `ROWS`, `COLS` | `2`, `3` | Grid dimensions |
| `SEED` | `7` | Random seed for tab in/out direction per edge |
| `NECK_X` | `0.42` | Where the tab neck begins (fraction of edge length, 0–0.5) |
| `BULB_CY` | `0.30` | Tab height as fraction of edge length |
| `BULB_R` | `0.17` | Tab bulb radius |
| `ATTACH_DROP` | `34` | Degrees from base where neck attaches to bulb |

---

## Custom Layout Pipeline

Once you have an SVG (hand-drawn or generated), run `bin/extract_layout.py` to produce the layout JSON:

```bash
# From the project root:
python3 bin/extract_layout.py graphics/my-pieces.svg
```

This computes the tight bounding box of each piece (including cubic bezier extrema), assigns piece IDs in `PIECE_ORDER` order, and writes a JSON file next to the source SVG. Move it into `layouts/`:

```bash
mv graphics/layout-my-pieces.json layouts/
```

Then point your config at it:

```json
"layout": { "type": "custom", "src": "layouts/layout-my-pieces.json" }
```

**Note on output filename:** If your SVG is named `puzzle-pieces-N.svg`, the output is `layout-N.json`. Otherwise the script appends `.json` to the base filename.

**Note on PIECE_ORDER:** The list near the top of `bin/extract_layout.py` controls the order pieces are assigned IDs (`p1`, `p2`, …) and therefore which config `pieces[]` entry corresponds to which shape. Update it if your piece labels differ.

---

## Included Piece Sets

| SVG | Description | Layout JSON |
|---|---|---|
| `graphics/6-geometric.svg` | Geometric 6-piece design, hand-drawn in Inkscape | `layouts/6-geometric.json` |
| `graphics/6-hand-drawn.svg` | Interlocking jigsaw with tabs, hand-drawn in Inkscape | `layouts/6-hand-drawn.json` |
| `graphics/6-generated.svg` | Parametric classic round-tab jigsaw (generated by `bin/generate_jigsaw.py`) | `layouts/6-generated.json` |
| `graphics/6-irregular.svg` | Human-shaped hand-drawn interlocking pieces | `layouts/6-irregular.json` |

The demo (`config.json`) uses `6-geometric.json` by default. To switch layouts, update the `"src"` value in `config.json`.

---

## Info Panel

Clicking (without dragging) any piece:
1. Flips the piece (3D animation)
2. Opens a full-height centered panel with the piece's title, subtitle, and description
3. **Pauses the timer** — time spent reading doesn't count against your score

Click the backdrop, the ✕ button, or press Escape to close. The timer resumes from where it paused.

---

## Markdown in Descriptions

The `description` field supports a subset of Markdown:

| Syntax | Result |
|---|---|
| `## Heading` | `<h2>` |
| `### Subheading` | `<h3>` |
| `**bold**` | **bold** |
| `*italic*` or `_italic_` | *italic* |
| `- item` or `* item` | bullet list |
| blank line | paragraph break |
| `[text](url)` | link (opens in new tab) |

In JSON, use `\n` for newlines. VS Code and most JSON editors handle this cleanly.

```json
"description": "## Mountains\n\nTowering peaks over **14,000 feet**.\n\n- Rocky ridgelines\n- Alpine meadows\n- Snow year-round"
```

---

## Score Tracking

Puzz stores scores in `localStorage` under `config.storageKey`:

```json
{
  "completions": 4,
  "fastestTime": 83421,
  "lastTime":    91200,
  "history":     [120000, 95000, 91200, 83421]
}
```

On load, fastest time and completion count appear in the HUD. On each completion, 5 waves of emojis fire — one per second, each wave larger and faster than the last:

| Wave | Emojis | Spawn gap |
|---|---|---|
| 1 | 20 | 45 ms |
| 2 | 25 | 35 ms |
| 3 | 30 | 25 ms |
| 4 | 35 | 15 ms |
| 5 | 40 | 8 ms |

If you beat your previous fastest time, 🏆 is mixed into the emoji pool at roughly 50/50 with the `celebrationEmojis` list. Customize the base pool via `config.celebrationEmojis`.

The completion message overlay appears after 1.5 seconds and fades out after 5 seconds, leaving the completed puzzle visible and fully interactive — click any piece to read its description.

---

## Running Tests

```bash
cd /path/to/Puzz
python3 -m http.server 8787
# open http://localhost:8787/test/puzz.test.html
```

The test page covers `_fmtTime`, `GRID_PRESETS`, `_gridLayout`, and `_renderMarkdown` (the pure functions). All results appear as green ✓ / red ✗ in the browser.

---

## Project Structure

```
Puzz/
  puzz.js            # Core engine — class Puzz, zero dependencies
  puzz.css           # All styles
  index.html         # Demo page
  config.json        # Demo config — edit to customize
  sample.jpg         # Demo image
  bin/
    extract_layout.py    # SVG → layout JSON
    generate_jigsaw.py   # Parametric round-tab jigsaw SVG generator
  graphics/
    6-geometric.svg      # Geometric 6-piece design, hand-drawn in Inkscape
    6-hand-drawn.svg     # Interlocking jigsaw tabs, hand-drawn in Inkscape
    6-generated.svg      # Parametric classic jigsaw (output of generate_jigsaw.py)
    6-irregular.svg      # Human-shaped hand-drawn interlocking pieces
  layouts/
    6-geometric.json     # Extracted layout for 6-geometric.svg
    6-hand-drawn.json    # Extracted layout for 6-hand-drawn.svg
    6-generated.json     # Extracted layout for 6-generated.svg
    6-irregular.json     # Extracted layout for 6-irregular.svg
  test/
    puzz.test.html       # Browser test page (serve and open in browser)
```

---

## License

MIT
