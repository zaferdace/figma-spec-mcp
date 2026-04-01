# figma-spec-mcp

![Version: 1.0.0-beta.4](https://img.shields.io/badge/version-1.0.0--beta.4-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)

<p align="center">
  <img src="assets/banner.png" alt="figma-spec-mcp — Bridge Figma to Game Engines" width="720" />
</p>

**Bridge Figma to any platform — Unity UGUI mappings built-in, structured output for React, Flutter, SwiftUI, and more.** Layout audit, design tokens, accessibility checks, prototype flows, version diffs, and platform-ready specs — all through MCP.

Works with **any MCP-compatible client**: Claude Code, Claude Desktop, Cursor, VS Code + Copilot, Windsurf, Cline, Continue.dev, Zed.

> **Security note:** Your Figma access token is passed as a tool argument. Never commit it to version control. Use environment variables or your AI client's secret management to supply it at runtime.

---

## Platform Support

| Platform | What you get |
|----------|-------------|
| **Unity** | `map_to_unity` — RectTransform data, layout groups, anchoring, UGUI component mapping |
| **React** | `map_to_react` — JSX tree, Tailwind/CSS classes, shadcn/MUI/Chakra/Radix component mapping, TypeScript props |
| **React Native** | `map_to_react` (inline style format) + `extract_design_tokens` → CSS variables |
| **Flutter** | `extract_design_tokens` → Style Dictionary JSON, layout hierarchy for Widget mapping |
| **SwiftUI** | `inspect_layout` with `framework: "swiftui"` hints, spacing/padding extraction |
| **Tailwind CSS** | `extract_design_tokens` → Tailwind config export |
| **Any platform** | `generate_implementation_contract` → structured spec with scope, assets, states, and acceptance criteria |

Your AI agent reads the structured output and generates platform-specific code. No manual translation needed.

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
- `map_to_react` — Maps a Figma frame to a React component tree with Tailwind/CSS classes, component library suggestions (shadcn, MUI, Chakra, Radix), asset hints, and TypeScript prop interfaces from variants.
- `map_to_unity` — Produces a Unity UGUI-oriented mapping with RectTransform data, layout groups, suggested components, notes, and warnings.
- `resolve_components` — Resolves instance nodes to their backing component definitions and returns source file and source node references.
- `extract_flows` — Extracts prototype transitions from a page or frame and returns directed flow connections plus a deterministic frame order.
- `bridge_to_codebase` — Scans a local project and maps Figma component names to likely implementation files using filename heuristics.
- `diff_versions` — Compares two Figma file versions and reports added, removed, and modified nodes.
- `extract_variants` — Reads a component set and returns structured variant metadata, parsed properties, dimensions, layout details, fills, and typography.
- `export_images` — Exports one or more Figma nodes as PNG, JPG, SVG, or PDF and returns the image URLs.
- `audit_accessibility` — Audits a frame for accessibility issues such as contrast, touch targets, font size, missing alt text, and color-only distinctions.
- `simplify_context` — Produces a token-efficient, LLM-oriented summary tree by collapsing wrappers, grouping repeated nodes, and truncating deep hierarchies.
- `lint_handoff_readiness` — Audits a frame for engineering handoff readiness: unnamed layers, absolute positioning soup, missing auto-layout, orphaned nodes, oversized images.
- `generate_implementation_contract` — Produces a structured implementation spec with scope, assets, states, interactions, dependencies, typography, colors, and acceptance criteria.
- `extract_missing_states` — Scans components for missing UI states (hover, pressed, disabled, loading, error, empty) against a standard expected-state set.
- `flow_to_test_cases` — Converts prototype flows into QA-ready test cases with navigation steps, expected outcomes, and flow coverage gaps.

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

### v0.5 — Handoff & QA
- `lint_handoff_readiness` — design-to-code readiness audit with scoring
- `generate_implementation_contract` — structured implementation scope + acceptance criteria
- `extract_missing_states` — component state coverage analysis
- `flow_to_test_cases` — prototype flows → QA test scenarios

### v0.6 — React & Platform AST
- `map_to_react` — Figma → React component tree with 4 style formats and 5 component libraries
- Normalized UI AST foundation — shared platform-agnostic tree for future mappers (Flutter, SwiftUI, React Native)

---

## Response Shape

All 16 tools return a consistent top-level envelope:

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

- [x] `map_to_react` — React component tree with Tailwind/CSS, component library mapping, TypeScript props
- [ ] `map_to_react_native` — React Native mapping (reuses normalized UI AST)
- [ ] `map_to_flutter` — Flutter Widget tree mapping with ThemeData export
- [ ] `map_to_swiftui` — SwiftUI view mapping with layout modifiers
- [ ] `detect_design_drift` — Compare Figma design against codebase implementation
- [ ] Webhook-triggered spec generation

---

## License

MIT © Zafer Dace
