# jio-ipo-analysis design

Approved: 2026-10-16
Artifact: https://claude.ai/artifact/TQZMJQqid8yanBmYW2P4pK (version 2)
Full design: [2026-10-16-jio-ipo-analysis-brew.md](2026-10-16-jio-ipo-analysis-brew.md). This file mirrors it, and the resolutions below take precedence over it.
Brief: [brief.md](brief.md)

## Resolved conflicts (binding for the build)

The brew spec holds both the judge's and the designer's assumptions, and they disagree in places. These answers were approved with the design:

| Topic | Decision |
|---|---|
| Stack | Use the design's stack table: Next.js 15 App Router, Better Auth (email and password, one seeded user, database sessions), Postgres 16 + pgvector, Drizzle, pg-boss, Node 22 worker, pnpm monorepo (apps/web, apps/worker, packages/db). Supabase, Vercel and Fly.io (Mumbai) are deploy targets only. |
| Polling cadence | X recent search 2 min (Apify X fallback 10 min); Reddit 5 min; Google News and publisher RSS 5 min; web search (site:instagram.com, site:linkedin.com, Groww, Emkay, Centrum) 15 min; YouTube search.list and commentThreads.list 15 min; Apify Instagram 30 min; Apify LinkedIn 30 min; IPO and GMP portals 10 min in NSE market hours (09:15-15:30 IST, weekdays), 60 min otherwise. All values are in config. |
| Taxonomy | 10 seeded topics plus Emerging and Unclassified, all editable: (1) Valuation and price band; (2) GMP and grey market; (3) Subscription and demand (QIB, NII, retail); (4) Allotment and retail access, incl. RIL shareholder quota; (5) Listing expectations and listing gains; (6) Ambani family, succession and leadership; (7) Governance, promoter control and related-party concerns; (8) Telecom business: tariffs, 5G, subscribers, ARPU; (9) Digital, AI and growth story; (10) Customer experience and service complaints. |
| Active topic | 10 or more items in the last 24h (configurable). Sentiment split is shown only at 30 or more items in the selected slice. |
| Windows | 15-minute rollup buckets; the trend compares the last 24h with the prior 24h; the timeline shows 7 days at hourly points; first-run backfill goes up to 7 days where an API allows it. |
| Retention | raw_json 30 days; post text and author rows 90 days; rollups and market points indefinitely; all configurable. |

## Local build constraints

- Postgres runs in Docker locally. No deploys, pushes or publishing during the build.
- Every source adapter has a fixture or fake mode and switches to live when its key is present in `.env`. The LLM classifier has a deterministic stub when no key is set.
