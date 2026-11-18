# `static/src/`

## Purpose

The OWL frontend — the interactive SVG window-design canvas and its
surrounding UI. This is the densest, least self-explanatory part of the
codebase (largest single file in the addon: `js/utils/window_svg.js` at
2254 lines) — read `docs/ARCHITECTURE.md` "Request lifecycle → Designer
canvas" first for how these pieces connect before diving into any one file.

## Structure

```
static/src/
├── js/
│   ├── wincraft_designer.js      Top-level orchestrator — owns the component tree
│   ├── wincraft_dashboard.js     Dashboard OWL component
│   ├── wincraft_load_check.js    Asset load guard
│   ├── components/               17 OWL components (see table below)
│   └── utils/                    10 pure-logic modules (see table below)
├── xml/                          OWL QWeb templates, one per component
└── scss/wincraft.scss            3804 lines — the "dark industrial" designer theme
```

## `js/components/` (17 files)

| File | Role |
|---|---|
| `designer_canvas.js` | Main SVG canvas |
| `properties_panel.js` (1639 lines) | Right-panel property editor — largest component |
| `window_object.js` | Per-window drag/resize |
| `component_library_panel.js` | Window/component palette |
| `designer_topbar.js` / `design_toolbar.js` | Top/design toolbars |
| `elevation_view.js` | Elevation/side-view panel |
| `window_filmstrip.js` | Thumbnail filmstrip of all windows |
| `new_window_wizard.js` | Add-window modal — **the window type/shape picker already lives here**, driven by `utils/window_type_config.js` |
| `window_iso_3d_dialog.js` | 3D isometric preview dialog |
| `quote_breakdown.js` | Quote price breakdown panel |
| `bom_live_panel.js` / `bom_preview.js` | Live/preview BOM panels |
| `opening_type_icon.js` | Opening-type icon component |
| `profile_optimiser.js` | Profile optimiser OWL component |
| `ai_assistant.js` | **Not registered in manifest assets — dead code, see KI-5** |
| `status_bar.js` | **Not registered in manifest assets — dead code, see KI-5** |

## `js/utils/` (10 files — pure calculation logic, no OWL dependency)

| File | Role |
|---|---|
| `window_svg.js` (2254 lines) | SVG rendering — `getWindowSVG()`, accessory rendering (`drawPaneAccessories()`) |
| `pricing.js` | Client-side live pricing (mirrors, but is not authoritative over, the server's `/wincraft/window/price`) |
| `bom_calculator.js` | Client-side BOM quantity calculation |
| `frame_shape_geometry.js` | Corner/frame geometry math |
| `canvas_state.js` | Reactive canvas state manager |
| `panel_tree.js` | Pane/panel hierarchy |
| `state_schema.js` | State-shape validation |
| `validation.js` | Configuration validation |
| `units.js` | Unit conversion — **decimal-inch display only today**, no fraction support (relevant to tickets WS-2/WS-8) |
| `window_type_config.js` | Client-side window-type/shape config, populated at runtime from `wincraft.window.type` |

## Known issues specific to this folder

- **KI-5** (`docs/KNOWN_ISSUES.md`): `ai_assistant.js`/`.xml` and
  `status_bar.js` are not in `__manifest__.py`'s asset list — never loaded.
- **KI-6**: `xml/_fix_glass_section.py` is a stray one-off patch script (not
  an OWL template despite living in the `xml/` folder) — harmless clutter,
  not executed by anything.
- **`units.js`'s doc comment is stale**: it claims rounding to "1/16″" but
  the actual implementation is decimal-inch only (`.toFixed(2)`) — don't
  trust the comment; this is exactly the gap WS-2/WS-8 need to close.

## Every new asset file must be registered

Odoo does not auto-discover `static/src/` files — every JS/XML/SCSS file
must be explicitly listed under `assets.web.assets_backend` in
`__manifest__.py`, or it silently never loads (as happened to `ai_assistant.js`
and `status_bar.js`). Check the manifest after adding a new file.

## Architecture notes

- Pure logic (`utils/`) is deliberately separated from OWL components so
  calculations stay testable independent of the component tree — see
  `docs/CODING_STANDARDS.md`.
- The canvas talks to the backend only through `controllers/` routes, never
  directly — see `docs/ARCHITECTURE.md` "Dependency rules & module
  boundaries."

## Parent / related

- Parent: [`wincraft_studio/README.md`](../../README.md)
- Related: [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md),
  [`docs/KNOWN_ISSUES.md`](../../../docs/KNOWN_ISSUES.md),
  [`docs/CODING_STANDARDS.md`](../../../docs/CODING_STANDARDS.md),
  [`../../controllers/README.md`](../../controllers/README.md)
