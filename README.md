# figma-spec

![Version: 0.4.0](https://img.shields.io/badge/version-0.4.0-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)

**An MCP server for AI agents that reads Figma files and returns structured, versioned specs for layout inspection, design extraction, accessibility review, prototype analysis, and platform handoff workflows.**

`figma-spec` gives AI agents deterministic access to Figma files with a built-in disk cache to reduce repeat API calls and keep tool output stable for downstream automation.

> **Security note:** Your Figma access token is passed as a tool argument. Never commit it to version control. Use environment variables or your AI client's secret management to supply it at runtime.

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

Most Figma MCP tools forward raw API responses. `figma-spec` adds stable envelopes, focused derivations, and reusable engineering outputs:

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

### v0.2

- Added component resolution, prototype flow extraction, and codebase bridging tools
- Added version diffing and variant extraction workflows

### v0.3

- Added image export and accessibility auditing tools
- Expanded analysis beyond layout and tokens into QA and asset workflows

### v0.4

- Added `simplify_context` for LLM-friendly frame summaries
- Unified tools around a shared response envelope with schema versioning and freshness metadata
- Shipped as `figma-spec` version `0.4.0`

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

Responses are cached to disk (default: `$TMPDIR/figma-spec-cache/`) by file key and request shape with a 1-hour TTL. Cache metadata is included in responses:

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
- [ ] Deeper accessibility heuristics and remediation guidance
- [ ] Smarter cache invalidation by file version

---

## License

MIT © Zafer Dace
