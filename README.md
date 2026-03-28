# figma-spec-mcp

![Version: 1.0.0-beta.1](https://img.shields.io/badge/version-1.0.0--beta.1-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)

<p align="center">
  <img src="assets/banner.png" alt="figma-spec-mcp — Bridge Figma to Game Engines" width="720" />
</p>

**Engineering-grade Figma specs for AI agents.** Layout audit, design tokens, accessibility checks, prototype flows, version diffs, and platform-ready mapping for Unity, React, SwiftUI, and more — all through MCP.

Works with **any MCP-compatible client**: Claude Code, Claude Desktop, Cursor, VS Code + Copilot, Windsurf, Cline, Continue.dev, Zed.

> **Security note:** Your Figma access token is passed as a tool argument. Never commit it to version control. Use environment variables or your AI client's secret management to supply it at runtime.

---

## Quick Start

**1. Get a Figma access token**
→ [figma.com/developers/api#access-tokens](https://www.figma.com/developers/api#access-tokens)

**2. Add to your MCP config** (Claude Desktop, Cursor, VS Code, or any MCP client):
```json
{
  "mcpServers": {
    "figma-spec-mcp": {
      "command": "npx",
      "args": ["-y", "figma-spec-mcp@beta"]
    }
  }
}
```

**3. Restart your AI client and use the tools.**

Your file key is in the Figma URL: `figma.com/file/<FILE_KEY>/...`

---

## Why figma-spec-mcp?

Most Figma MCP tools forward raw API responses. `figma-spec-mcp` adds stable envelopes, focused derivations, and reusable engineering outputs:

- Deterministic JSON responses with a shared response envelope
- Built-in disk cache with freshness metadata on every result
- Source traceability for tokens, mappings, and extracted relationships
- Platform-ready outputs for Unity, codebase mapping, and image export workflows

---

## Tools

- `inspect_layout` — Inspects a Figma frame and returns hierarchy, layout structure, spacing, constraints, annotations, and basic accessibility warnings.
- `extract_design_tokens` — Extracts color, typography, and spacing tokens from a Figma file and exports them as CSS variables, Style Dictionary JSON, or Tailwind config.
- `map_to_unity` — Produces a Unity UGUI-oriented mapping with RectTransform data, layout groups, suggested components, notes, and warnings.
- `resolve_components` — Resolves instance nodes to their backing component definitions and returns source file and source node references.
- `extract_flows` — Extracts prototype transitions from a page or frame and returns directed flow connections plus a deterministic frame order.
- `bridge_to_codebase` — Scans a local project and maps Figma component names to likely implementation files using filename heuristics.
- `diff_versions` — Compares two Figma file versions and reports added, removed, and modified nodes.
- `extract_variants` — Reads a component set and returns structured variant metadata, parsed properties, dimensions, layout details, fills, and typography.
- `export_images` — Exports one or more Figma nodes as PNG, JPG, SVG, or PDF and returns the image URLs.
- `audit_accessibility` — Audits a frame for accessibility issues such as contrast, touch targets, font size, missing alt text, and color-only distinctions.
- `simplify_context` — Produces a token-efficient, LLM-oriented summary tree by collapsing wrappers, grouping repeated nodes, and truncating deep hierarchies.

---

## Features

### v0.1 — Core
- `inspect_layout`, `extract_design_tokens`, `map_to_unity`
- Disk cache with SHA-256 keying and 1h TTL

### v0.2 — Intelligence
- Token name preservation from Figma styles
- Depth-limited chunking for large files
- Mixed/rich text runs extraction
- Annotation extraction, framework-aware hints (Unity, React, SwiftUI, Web)

### v0.3 — Workflows
- `resolve_components` — multi-file component traversal
- `extract_flows` — prototype flow graph
- `bridge_to_codebase` — Figma → repo file matching
- `diff_versions` — structured version diff
- `extract_variants` — component set batch extraction

### v0.4 — Quality & DX
- `export_images` — PNG/JPG/SVG/PDF export
- `audit_accessibility` — WCAG 2.1 contrast, touch targets, font size
- `simplify_context` — AI-optimized, token-efficient output
- Tool registry pattern for easy contribution
- Rate limit handling (429 + Retry-After)

---

## Response Shape

All 11 tools return a consistent top-level envelope:

```json
{
  "schema_version": "0.1.0",
  "source": { "file_key": "abc123", "node_id": "1:23" },
  "freshness": {
    "fresh": true,
    "timestamp": "2026-03-26T10:00:00.000Z",
    "ttl_ms": 3600000
  },
  "warnings": [],
  "data": {}
}
```

Tool-specific results live in `data`, and most tools also include low-level cache metadata there.

---

## Caching

Responses are cached to disk (default: `$TMPDIR/figma-spec-mcp-cache/`) by file key and request shape with a 1-hour TTL. Cache metadata is included in responses:

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
git clone https://github.com/zaferdace/figma-spec-mcp
cd figma-spec-mcp
npm install
npm run build
node dist/index.js
```

---

## Roadmap

- [ ] Export to React Native StyleSheet
- [ ] Export to Flutter ThemeData
- [ ] Semantic component detection (button/card/nav inference)
- [ ] Webhook-triggered spec generation
- [ ] Plugin API companion for live document access

---

## License

MIT © Zafer Dace
