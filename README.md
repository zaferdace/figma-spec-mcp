# figma-spec

![Status: Early Development](https://img.shields.io/badge/status-early%20development-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)

**Engineering-grade Figma audits and platform-ready specs for AI agents.**

`figma-spec` is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI agents (Claude, Cursor, etc.) structured, versioned access to Figma files — deterministic layout data, extracted design tokens, and Unity UGUI hierarchies, with a built-in disk cache to avoid Figma API rate limits.

---

## Quick Start

**1. Get a Figma access token**
→ [figma.com/developers/api#access-tokens](https://www.figma.com/developers/api#access-tokens)

**2. Add to your MCP config** (`claude_desktop_config.json` or `.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "figma-spec": {
      "command": "npx",
      "args": ["-y", "figma-spec"]
    }
  }
}
```

**3. Restart your AI client and use the tools.**

Your file key is in the Figma URL: `figma.com/file/<FILE_KEY>/...`

---

## Why figma-spec?

Most Figma MCP tools just forward raw API responses. `figma-spec` does the engineering work:

- **Deterministic output** — versioned JSON schemas (`figma-spec/inspect-layout@1`) with stable field contracts
- **Built-in disk cache** — responses cached by file key + node ID with a 1-hour TTL; cache freshness reported in every response. No more 429s from repeated queries (a known pain point with GLips/Framelink)
- **Confidence scores** — inferred fields (Unity component suggestions) are marked with `"confidence": "high" | "medium" | "low"`
- **Source traceability** — every design token includes `sourceNodeIds` pointing back to where it was found

---

## Tools

### `inspect_layout`

Returns deterministic layout data for a Figma frame: node hierarchy, auto-layout vs absolute positioning, spacing/padding/constraints, and accessibility warnings.

**Input:**
```json
{
  "file_key": "abc123",
  "node_id": "1:23",
  "access_token": "figd_..."
}
```

**Output:**
```json
{
  "schema": "figma-spec/inspect-layout@1",
  "frameId": "1:23",
  "frameName": "HomeScreen",
  "dimensions": { "width": 390, "height": 844 },
  "hierarchy": [
    { "id": "1:23", "name": "HomeScreen", "type": "FRAME", "depth": 0, "childCount": 4, "positioningMode": "auto-layout" },
    { "id": "1:24", "name": "Header", "type": "FRAME", "depth": 1, "childCount": 2, "positioningMode": "auto-layout" }
  ],
  "autoLayouts": [
    {
      "nodeId": "1:23",
      "mode": "vertical",
      "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 },
      "gap": 12,
      "sizing": { "width": "fixed", "height": "fixed" }
    }
  ],
  "constraints": [
    { "nodeId": "1:24", "horizontal": "LEFT_RIGHT", "vertical": "TOP", "bounds": { "x": 0, "y": 0, "width": 390, "height": 56 } }
  ],
  "accessibilityWarnings": [
    { "nodeId": "1:31", "rule": "min-font-size", "severity": "warning", "message": "Font size 10px is below the recommended minimum of 11px.", "evidence": "fontSize=10" }
  ],
  "stats": { "totalNodes": 22, "autoLayoutNodes": 6, "absoluteNodes": 16, "textNodeCount": 5 },
  "cache": { "cachedAt": "2026-03-26T10:00:00.000Z", "expiresAt": "2026-03-26T11:00:00.000Z", "fresh": true }
}
```

---

### `extract_design_tokens`

Extracts colors, typography, and spacing from an entire Figma file and exports them in your chosen format. Every token includes `sourceNodeIds` for traceability.

**Input:**
```json
{
  "file_key": "abc123",
  "access_token": "figd_...",
  "export_format": "css-variables"
}
```

**Export formats:** `css-variables` | `style-dictionary` | `tailwind`

**Example CSS output:**
```css
:root {
  --color-1a73e8: rgba(26, 115, 232, 1.00);
  --color-ffffff: rgba(255, 255, 255, 1.00);
  --text-inter-16-family: "Inter";
  --text-inter-16-size: 16px;
  --text-inter-16-weight: 400;
  --spacing-8: 8px;
  --spacing-16: 16px;
  --spacing-24: 24px;
}
```

---

### `map_to_unity`

Converts a Figma frame into a Unity UGUI hierarchy with RectTransform values, LayoutGroup configs, and suggested components per node.

**Input:**
```json
{
  "file_key": "abc123",
  "node_id": "1:23",
  "access_token": "figd_...",
  "canvas_width": 1080,
  "canvas_height": 1920
}
```

**Output:**
```json
{
  "schema": "figma-spec/map-to-unity@1",
  "rootNode": {
    "name": "HomeScreen",
    "figmaId": "1:23",
    "figmaType": "FRAME",
    "rectTransform": {
      "anchorMin": { "x": 0, "y": 0 },
      "anchorMax": { "x": 1, "y": 1 },
      "anchoredPosition": { "x": 0, "y": 0 },
      "sizeDelta": { "x": 0, "y": 0 },
      "pivot": { "x": 0.5, "y": 0.5 }
    },
    "layoutGroup": {
      "type": "VerticalLayoutGroup",
      "spacing": 12,
      "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 },
      "childAlignment": "UpperLeft",
      "controlWidth": false,
      "controlHeight": false
    },
    "suggestedComponents": ["RectTransform", "Image", "VerticalLayoutGroup"],
    "confidence": "high",
    "children": []
  },
  "canvasSize": { "width": 1080, "height": 1920 },
  "notes": ["\"Icon\" (VECTOR) — export as sprite for Unity Image component."],
  "warnings": ["\"BlurPanel\" has blur effects — Unity UGUI does not natively support blur."],
  "cache": { "cachedAt": "2026-03-26T10:00:00.000Z", "fresh": true }
}
```

**Constraint → Anchor mapping:**

| Figma | Unity anchorMin/Max |
|-------|---------------------|
| Left | `(0,x) → (0,x)` |
| Right | `(1,x) → (1,x)` |
| Center H | `(0.5,x) → (0.5,x)` |
| Left & Right | `(0,x) → (1,x)` stretch |
| Top | `(x,1) → (x,1)` |
| Bottom | `(x,0) → (x,0)` |
| Top & Bottom | `(x,0) → (x,1)` stretch |
| Scale | stretch both axes |

---

## Caching

Responses are cached to disk (default: `$TMPDIR/figma-spec-cache/`) by file key + node ID with a 1-hour TTL. Every response includes a `cache` field:

```json
"cache": {
  "cachedAt": "2026-03-26T10:00:00.000Z",
  "expiresAt": "2026-03-26T11:00:00.000Z",
  "fileVersion": "123456789",
  "fresh": true
}
```

---

## Development

```bash
git clone https://github.com/zaferdace/figma-spec
cd figma-spec
npm install
npm run build
node dist/index.js
```

---

## Roadmap

- [ ] Named style extraction (Figma Styles API)
- [ ] Component variant mapping
- [ ] Export to React Native StyleSheet
- [ ] Export to Flutter ThemeData
- [ ] WCAG contrast ratio checks
- [ ] Cache invalidation by file version

---

## License

MIT © Zafer Dace
