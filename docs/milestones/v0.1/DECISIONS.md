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
