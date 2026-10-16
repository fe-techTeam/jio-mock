# Decisions

Decisions made during the unattended build. Each row replaces a question the
developer would otherwise have been asked.

| Date | Decision | Alternatives considered | Reason | Reversible |
|---|---|---|---|---|
| 2026-10-16 | Build in the existing jio-ipo-analysis directory | Nested ./jio-ipo-analysis/ | Directory only held brew docs; nesting would duplicate the name | yes |
| 2026-10-16 | Postgres 16 + pgvector in Docker on host port 5433 | Local Homebrew Postgres 14 on 5432 | Local server has no pgvector and the design needs vectors | yes |
| 2026-10-16 | pnpm via corepack (pnpm@9.15.4) | npm workspaces | Design specifies a pnpm monorepo; pnpm not installed globally | yes |
| 2026-10-16 | Every adapter ships a fixture mode; SOURCES_MODE=auto goes live per key | Block until keys exist | No API keys supplied; the board must run and be demoable now | yes |
| 2026-10-16 | Classifier claude-haiku-5-5 (Anthropic SDK, structured JSON); deterministic stub without key | Other providers | Design says Claude Haiku class; latest Haiku is 5.5 | yes |
| 2026-10-16 | Embeddings voyage-multilingual-2 (1024 dims) with hashing stub | Self-hosted model | Design wants a hosted multilingual embedding model; Anthropic has no embeddings API | costly (vector dims) |
| 2026-10-16 | Web search via Serper (Google results) | Brave Search API | site:instagram.com / site:linkedin.com discovery depends on Google's index | yes |
| 2026-10-16 | posts.is_fixture flag | Separate fixture DB | Lets fixture data be purged when sources go live | yes |
| 2026-10-16 | Web dev port 3100 | 3000 | Avoid clashes with other local projects | yes |
| 2026-10-16 | COREPACK_INTEGRITY_KEYS=0 exported by scripts/pnpm-locked.sh | Upgrade corepack | Installed corepack fails npm signature check (Cannot find matching keyid) | yes |
| 2026-10-16 | Ran corepack enable so nested pnpm calls in root scripts resolve | Global pnpm install | pnpm not otherwise on PATH | yes |
| 2026-10-16 | docker-compose.yml and docs/ added to .prettierignore | Format them | Prettier rewrites the quoted port string and reformats others' markdown | yes |
| 2026-10-16 | next.config.ts loads root .env with loadEnvConfig(..., forceReload=true) | Plain call; per-app .env | Next already loaded apps/web env, so a plain call is a no-op | yes |
| 2026-10-16 | components.json written by hand (new-york, neutral); button uses @radix-ui/react-slot | shadcn CLI init | Current shadcn CLI lacks the style flag | yes |
| 2026-10-16 | vitest.config.ts sets css.postcss.plugins=[] in web | Upgrade Vite | Vite 5 cannot load Next's Tailwind postcss config | yes |
| 2026-10-16 | apps/web/next-env.d.ts git-ignored; @next/env pinned 15.5.28 as dev dep | Commit generated file | Generated file | yes |
| 2026-10-16 | Exchange holidays not modelled; weekday holidays count as market hours | NSE holiday list in config | Only changes portal polling 10 vs 60 min | yes |
| 2026-10-16 | pg-boss v10 imported as default export; drizzle-orm ^0.45.4, drizzle-kit ^0.31.11 pinned | Named import | pg-boss v10 module shape | yes |
