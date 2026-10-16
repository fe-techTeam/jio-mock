---
phase: 02-ingestion
plan: 03
requires:
  - { phase: 02-ingestion, provides: "SourceAdapter stubs, _fixture helpers (fixtureFetch, createFakeFetch), breaker error classes, runner lane resolution and detail.quota convention (02-01)" }
  - { phase: 01-data-and-login, provides: "TermsConfig and compileMatcher (01-01)" }
provides:
  - "news_rss live adapter: Google News en/hi/gu plus 6 publisher feeds; exports PUBLISHER_FEEDS, buildGoogleNewsQueries, createNewsRssAdapter"
  - "web_search live adapter (Serper): 8 queries a run; exports DOMAIN_OUTLETS, SERPER_COST_PER_QUERY_USD (0.001), parseSerperDate, createWebSearchAdapter"
  - "reddit live adapter (OAuth client credentials): exports WATCH_SUBREDDITS, buildRedditQuery, createRedditAdapter; comments carry rawJson.parentTitle for 03-01 triage"
  - "youtube live adapter with quota pacing: exports BUDGET, allowance, ptDay, nextPtMidnight, buildYoutubeQuery, YOUTUBE_NEWS_CHANNELS, createYoutubeAdapter; every live run returns a cursor whose quota.unitsUsedToday is copied to fetch_run detail.quota (for 05-01)"
affects: [05-operator-pages, 03-classification, 07-hardening]
key_files:
  - apps/worker/src/adapters/news-rss.ts
  - apps/worker/src/adapters/web-search.ts
  - apps/worker/src/adapters/reddit.ts
  - apps/worker/src/adapters/youtube.ts
  - apps/worker/src/adapters/fixtures.test.ts
key_decisions:
  - "YouTube cursor is JSON {v:1, quota:{day,unitsUsedToday,limit,resetsAt}, tracked:[{id,publishedAt,views}]}; allowance(now)=min(9000, 9000*ptDayFraction+200); search runs only when units+121<=allowance"
  - "Serper cost is an estimate of 0.001 USD a query (queries actually sent), not a billed figure"
  - "Missing credentials in live mode raise NotConfiguredError (runner normally prevents this)"
issues_created: []
completed: 2026-10-16
---

# 02-03: Tier-1 live adapters (news RSS, web search, Reddit, YouTube)

**Live news RSS (Google News en/hi/gu plus 6 publisher feeds), Serper web search, Reddit OAuth search with thread comments, and quota-paced YouTube search and comments, all tested against hand-written recorded responses through an injected fetch.**

## Accomplishments

- news_rss: 9 requests a run (3 Google News, 6 publishers); publisher items must pass the core matcher; one failing feed degrades, all failing rejects naming every feed. Google News `<source url>` is read with cheerio because rss-parser drops attributes.
- web_search: 8 Serper POSTs (2 phrases x instagram, linkedin posts, Groww, Emkay/Centrum). Instagram and LinkedIn hits are author kind 'other' (social lane via resolvePostLane); instagram post URLs get `ig-post:<code>`; outlet domains are media_outlet; others are platform 'web' with no kind. externalId `ws:` + sha256 prefix of the normalized link.
- reddit: token cached per adapter instance (refreshed within 60s of expiry), 1 global plus 6 restricted searches, comments for up to 10 threads under 48h old; max 18 requests a run; stops when x-ratelimit-remaining < 5.
- youtube: search.list, one videos.list for new ids, commentThreads per tracked video (max 20). The 96-run, 15-minute simulation stays at or below 9,000 units with at least 60 search runs.
- Exports for later plans: PUBLISHER_FEEDS, DOMAIN_OUTLETS, WATCH_SUBREDDITS, YOUTUBE_NEWS_CHANNELS.

## Task commits

1. Task 1: News RSS and Serper web-search adapters - `f0ce7d0` (feat)
2. Task 2: Reddit OAuth search adapter - `5569b75` (feat)
3. Task 3: YouTube adapter with quota pacing - `cddd09b` (feat)

## Decisions

- Query plan for the "8 queries" requirement: for each of the first two English IPO phrases, `site:instagram.com "p"`, `site:linkedin.com/posts "p"`, `"p" Groww`, `"p" (Emkay OR Centrum)`.
- YouTube comment-phase quotaExceeded rejects the whole run (RateLimitedError at next Pacific midnight), per the plan; the cursor is then not advanced.
- Extra `news_channel_ids` in the youtube source params also mark a channel as media_outlet.

## Deviations from plan

### Auto-fixed
- **[Rule 3 - blocker] 02-01 stub-rejection test** - `fixtures.test.ts` asserted that all non-portal adapters reject live mode with NotConfiguredError('live mode not built'); with real adapters news_rss would hit the network. Excluded youtube, reddit, news_rss and web_search from that assertion (same approach 02-04 used for portals); verified by full worker suite; commit `cddd09b`.
- **[Rule 1 - consistency] Missing creds** raise NotConfiguredError, not SourceAuthError; commit `cddd09b`.

### Deferred to ISSUES.md
- ISS-A: verify the publisher feed URLs on the first live run (best-known values from the plan).
- ISS-B: `src/index.test.ts` "fills posts from the 8 non-portal fixtures" fails since 02-04 (portal adapters now return posts in fixture mode, so 11 sources have posts); not touched here (outside this plan's files).
- ISS-C: nextPtMidnight ignores the two DST-change days a year (resetsAt off by one hour).
- ISS-D: a thrown YouTube/Reddit error loses the cursor (quota counter), so after a quotaExceeded the next day-run restarts from the last ok cursor's counter; harmless because the day check resets it, but intraday units can under-count after a failed run.
- ISS-E: the first-run Google News en query is capped to 6 phrases; Hinglish and entity-alias phrases are not searched there.

## Verification

- Tests: `corepack pnpm exec vitest run` in apps/worker -> 335 passed, 1 failed (index.test.ts, pre-existing from 02-04, see ISS-B). New: news-rss 11, web-search 11, reddit 16, youtube 19.
- Build / types / lint: `tsc --noEmit` PASS, root `pnpm lint` PASS.
- `git diff` shows no change to adapters/index.ts, _fixture.ts, runner.ts or package.json.

## Next-phase readiness

- 05-01: read `detail.quota` ({day, unitsUsedToday, limit, resetsAt}) from the latest youtube fetch_run.
- 03-01: Reddit comments have `rawJson.parentTitle` and `parentId`; web_search/news_rss posts are not matcher-filtered (except publisher feeds).
- Live paths run only with keys present; web_search needs SERPER_API_KEY, reddit REDDIT_CLIENT_ID/SECRET, youtube YOUTUBE_API_KEY; news_rss needs none (so SOURCES_MODE=auto runs it live).
