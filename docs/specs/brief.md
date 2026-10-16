# jio-ipo-analysis brief

Design source: [2026-10-16-jio-ipo-analysis-brew.md](2026-10-16-jio-ipo-analysis-brew.md) (brew-idea run wf_256792fe-795, revision 1).

## Pitch
A private Next.js + shadcn dashboard, refreshed every few minutes, that shows the Ambani family and Jio's strategy team which talking points the public is raising about the Jio Platforms IPO and Mukesh, Akash and Isha Ambani. It shows how sentiment on each one is moving, with the real posts behind every number. We act as the intelligent partner supplying the stats; the strategy team writes the replies.

## Users
- Primary: Jio strategy team (frames the family's public replies).
- Secondary: Ambani family members (glanceable mood check); our operator team (keeps sources healthy, curates topics and keywords, measures label accuracy).

## Platform
Web only. Desktop-first, responsive for laptop and iPad.

## Core flows
1. Open the executive brief, scan the ranked active talking points (sentiment split, volume, 24h trend), and filter by entity (Mukesh, Akash, Isha, Jio).
2. Click any number to open the evidence drawer: the actual posts and articles behind it, with source links.
3. Open a topic's detail page: sentiment over time with GMP and subscription market context.
4. Operator: check source freshness, cadence and spend; edit tracked keywords and cadence; relabel posts and see the accuracy figure against the gold set.

## Data
Post (normalized item from any source) → Author (isolated table, kept for later person-level views) ; Post → Classification (topic, sentiment, entity mentions, confidence) ; Topic (seeded 10-topic taxonomy plus Emerging and Unclassified) ; TopicStat15m (precomputed rollups) ; MarketPoint (GMP and subscription series) ; Config (versioned keywords and cadence) ; EventLog.

## Auth and roles
A single login (email and password, one seeded user), database sessions and an audit log. No roles in v1; author data stays in its own table so roles can be added later.

## Integrations
X API (adapter built now; tier and credentials go in config later), Apify (Instagram, LinkedIn, X fallback), YouTube Data API v3, Reddit, news RSS, web search, IPO portals (InvestorGain, Chittorgarh, IPOWatch), financial media (Mint, ETMarkets and others via RSS and search), and an LLM for classification.

## Constraints
- Always on: before, during and after the IPO, with no dependence on IPO dates.
- "Real time" means polling each source every 2 to 15 minutes, with the dashboard refetching every 30 seconds.
- Budget is assumed high but tracked per source.
- No email or alerts in v1.
- Possible SEBI and DPDP rules apply, so v1 shows topics only and puts no author data in exports.

## References
influ-finder (../influ-finder) for ingestion ideas only: no code or stack is copied.

## Assumptions
- Stack is taken from the approved brew design: pnpm monorepo (apps/web Next.js + shadcn, apps/worker Node 22, packages/db Drizzle), Postgres 16 + pgvector, pg-boss, Better Auth, TanStack Query.
- The local build runs Postgres in Docker. Deploys to Vercel, Fly.io and Supabase (all Mumbai) are documented but not run, because jump-start does not deploy.
- Source API keys are not available yet. Every adapter ships with a fake or fixture mode and switches to live when its key is present in `.env`.
- The LLM classifier is called through a provider interface, with a deterministic stub when no key is set.
