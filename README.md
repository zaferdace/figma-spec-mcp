# figma-dissect

![Status: Early Development](https://img.shields.io/badge/status-early%20development-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)

> Engineering-grade Figma audits and platform-ready specs for AI agents.

`figma-dissect` is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI agents (Claude, Cursor, etc.) deep, structured access to Figma files — beyond basic inspection. It extracts component maps, layout trees, design tokens, and Unity-ready UGUI hierarchies directly from your Figma designs.

---

## Quick Start

```bash
npx figma-dissect
```

Or install globally:

```bash
npm install -g figma-dissect
figma-dissect
```

---

## Usage with Claude / Cursor

Add to your MCP config (`claude_desktop_config.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "figma-dissect": {
      "command": "npx",
      "args": ["-y", "figma-dissect"]
    }
  }
}
```

You'll need a [Figma personal access token](https://www.figma.com/developers/api#access-tokens) and a file key (from any Figma file URL: `figma.com/file/<FILE_KEY>/...`).

---

## Tools

### `analyze_frame`

Audits a Figma frame and returns structured engineering data.

**Input:**
```json
{
  "file_key": "abc123",
  "node_id": "1:23",
  "access_token": "figd_..."
}
```

**Output includes:**
- Component inventory (components, instances, types)
- Layout analysis (auto-layout mode, padding, gap, sizing)
- Constraint mapping (per-node horizontal/vertical constraints)
- Accessibility warnings (small text, missing fills, etc.)
- Node statistics (total count, text nodes, image nodes)

**Example output:**
```json
{
  "frameId": "1:23",
  "frameName": "HomeScreen",
  "dimensions": { "width": 390, "height": 844 },
  "stats": { "totalNodes": 47, "componentCount": 3, "instanceCount": 12, "textNodeCount": 8 },
  "accessibilityWarnings": [
    { "severity": "warning", "message": "Text node \"Caption\" has font size 10px, may be too small." }
  ]
}
```

---

### `extract_design_tokens`

Extracts colors, typography, and spacing from an entire Figma file.

**Input:**
```json
{
  "file_key": "abc123",
  "access_token": "figd_...",
  "export_format": "css-variables"
}
```

**Export formats:**
- `css-variables` — CSS custom properties (`:root { --color-... }`)
- `style-dictionary` — [Style Dictionary](https://amzn.github.io/style-dictionary/) JSON
- `tailwind` — Tailwind CSS config extension

**Example CSS output:**
```css
:root {
  --color-1a73e8: rgba(26, 115, 232, 1.00);
  --text-inter-16-family: "Inter";
  --text-inter-16-size: 16px;
  --text-inter-16-weight: 400;
  --spacing-8: 8px;
  --spacing-16: 16px;
}
```

---

### `map_to_unity`

Converts a Figma frame to a Unity UGUI-ready hierarchy.

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

**Output includes:**
- Full node tree with Unity component suggestions (`Image`, `TextMeshProUGUI`, `HorizontalLayoutGroup`, etc.)
- `RectTransform` values (anchorMin, anchorMax, anchoredPosition, sizeDelta, pivot)
- `LayoutGroup` config derived from Figma auto-layout
- Notes for assets requiring manual export (vectors, masks)
- Warnings for unsupported effects (blur, etc.)

**Example output:**
```json
{
  "rootNode": {
    "name": "HomeScreen",
    "rectTransform": {
      "anchorMin": { "x": 0, "y": 0 },
      "anchorMax": { "x": 1, "y": 1 },
      "anchoredPosition": { "x": 0, "y": 0 },
      "sizeDelta": { "x": 390, "y": 844 }
    },
    "components": ["RectTransform", "Image"],
    "children": [...]
  },
  "warnings": ["Node \"BlurPanel\" has blur effects — Unity UGUI does not natively support blur."]
}
```

---

## Constraint → Anchor Mapping

| Figma Constraint | Unity Anchor |
|-----------------|--------------|
| Left | `(0,0) → (0,0)` |
| Right | `(1,1) → (1,1)` |
| Center | `(0.5,0.5) → (0.5,0.5)` |
| Left & Right | `(0,0) → (1,0)` stretch |
| Top | `(x,1) → (x,1)` |
| Bottom | `(x,0) → (x,0)` |
| Top & Bottom | `(x,0) → (x,1)` stretch |
| Scale | stretch both axes |

---

## Development

```bash
git clone https://github.com/zaferdace/figma-dissect
cd figma-dissect
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
- [ ] Image fill → sprite export references
- [ ] Accessibility score (WCAG contrast ratios)

---

## License

MIT © Zafer Dace
