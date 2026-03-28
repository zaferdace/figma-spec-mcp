# Contributing to figma-spec-mcp

## Development Setup

```bash
git clone https://github.com/zaferdace/figma-spec-mcp.git
cd figma-spec-mcp
npm install
npm run build
```

## Type Checking

```bash
npx tsc --noEmit
```

## Pull Request Process

1. Fork the repository
2. Create a branch from `main` (e.g., `feat/my-feature` or `fix/my-bug`)
3. Make your changes
4. Ensure the build and type check pass
5. Open a PR against `main` with a clear description of what and why

## Code Style

- TypeScript strict mode — all files must pass `tsc --noEmit` with no errors
- No `any` types — use `unknown` and narrow explicitly
- Comments only where the logic is not self-evident
- Keep functions focused and small
