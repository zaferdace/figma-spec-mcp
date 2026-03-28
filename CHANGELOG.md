# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-beta.1] - 2026-03-28

### Added
- ESLint (typescript-eslint strict) + Prettier formatting
- publint for npm publish validation
- CI pipeline: lint + format check + publint + SonarCloud
- `npm run check` script for all validations
- GitHub Actions publish workflow (tag-based, beta/latest channels)
- `exports` field in package.json for modern Node.js

### Changed
- Version bump to 1.0.0-beta.1 (semver: first public pre-release)
- Renamed from `figma-spec` to `figma-spec-mcp` for discoverability

## [0.4.0] - 2026-03-28

### Added
- Registry-based tool registration via `src/tools/registry.ts` and `src/tools/register-all.ts`
- `export_images` for Figma image export URL generation
- `audit_accessibility` for WCAG-oriented contrast, touch target, alt text, font size, and color-only heuristics
- `simplify_context` for AI-optimized, token-efficient frame summaries

## [0.3.0] - 2026-03-29

### Added
- `resolve_components`, `extract_flows`, `bridge_to_codebase`, `diff_versions`, and `extract_variants` tools
- Public launch preparation including `CONTRIBUTING`, CI, and issue templates

## [0.2.0] - 2026-03-28

### Added
- Token name preservation — design token names are retained through the extraction pipeline instead of being normalized away
- Depth-limited chunking — layout trees are chunked with a configurable depth limit to avoid oversized payloads
- Mixed text run support — text nodes with multiple styles are now decomposed into typed runs
- Annotation extraction — developer annotations attached to Figma nodes are surfaced in tool output
- Framework-aware hints — `map_to_unity` output includes component hints tailored to the target framework

## [0.1.0] - 2026-01-01

### Added
- `inspect_layout` — audit Figma frames and return structured layout trees with constraint and auto-layout data
- `extract_design_tokens` — extract colors, typography, effects, and spacing tokens from a Figma file
- `map_to_unity` — map Figma components to Unity UGUI equivalents with placement metadata
- Disk cache — Figma API responses are cached locally to reduce redundant network calls
