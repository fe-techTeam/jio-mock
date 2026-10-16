# jio-ipo-analysis brew

Date: 2026-10-16
Brief: Real-time dashboard of public talking points (X, Instagram, LinkedIn, YouTube, Reddit, news, IPO/GMP portals, brokerages) about the Jio IPO and Mukesh, Akash and Isha Ambani, each classified positive/neutral/negative, polled every x minutes within API constraints, used by the Ambani family and strategy team to frame public replies; Next.js + shadcn; data stored so both topic-level views and later individual references are possible.
Source: brew-idea run wf_256792fe-795 (revision 1; supersedes run wf_753a00f0-e16)

## Vision

A private, always-on Next.js + shadcn dashboard that shows the Ambani family and Jio's strategy team which talking points the public is raising about the Jio Platforms IPO and Mukesh, Akash and Isha Ambani. For each one it shows how sentiment is moving, with the real posts behind every number, refreshed every few minutes from social, news and IPO-portal sources.

A private Next.js + shadcn dashboard, refreshed every few minutes, that shows the Ambani family and Jio's strategy team which talking points the public is raising about the Jio Platforms IPO and Mukesh, Akash and Isha Ambani, how sentiment on each is moving, and the real posts behind every number.

Goals:
- The strategy team sees every active talking point about the Jio IPO and the three Ambanis on one screen that updates itself. Each one shows its positive/neutral/negative split, its volume, and its trend over the last 24h compared with the 24h before.
- Every number can be clicked through to the real posts behind it, with source links and reach. A wrong label can be corrected in one click, and the stated accuracy figure comes only from a 200-post gold set.
- 'Real time' is shown honestly. For each source the dashboard shows its polling interval, its last successful fetch, whether it is sampled or fully searched, and its spend, so nobody mistakes minutes-old data for live data.
- Posts are stored with author references kept in a separate table. Topic-level views ship now, and person-level views can be added later if the legal review allows them.

Not doing:
- IPO phase selector and calendar-tuned polling. The system runs continuously before, during and after the IPO. The only time-based rule is faster portal polling during NSE market hours.
- Spike and negative-shift alerts (email, Slack, WhatsApp). There are no alerts of any kind in v1; they are listed as a later item.
- Hard daily spend kill-switch and degrade-to-sampling at cap. Spend is tracked but never limits cadence or sources.
- SSO allowlist, MFA, viewer roles and screenshot watermarking. v1 has one login.
- Compliance sign-off as a hard gate before any data is stored
- Forking or copying influfinder code or stack
- Headline 'organic estimate' percentage
- 'Who is driving this' named-author list and author-type weighting
- Per-individual author profiles and dossiers
- Reply drafting or strategy suggestions. We supply the stats, and the strategy team frames the replies.
- WebSocket/SSE streaming and X filtered stream
- Historical backfill beyond 7 days
- Bespoke scrapers per brokerage (Emkay, Centrum, Groww)
- Auto-discovered clustering as the primary topic view
- Custom report builder and export suite
- Custom-trained or fine-tuned sentiment models
- Per-post sentiment scores to two decimals

Success looks like: The strategy team settles a reply decision by opening a talking point's evidence drawer and quoting the real posts in it, and at that moment every source on the Sources page shows a successful fetch within twice its configured interval.

## Design

### Who uses it

**Strategy team lead (Jio strategy / comms)**: Each morning and through the day, know which talking points are growing or turning negative, for which Ambani or for Jio, and get the exact public wording to frame a reply around.
Flow: Sign in on the login page → Scan the executive brief: talking points ranked by 24h volume, each with a sentiment bar and trend arrow → Set the entity filter to 'Isha' and the lane toggle to 'Social' → See that 'Governance and regulation' is 40% more negative than the prior 24h, with a low suspected-coordinated count → Click the negative segment of the bar, which opens the evidence drawer sorted by reach → Read the top posts, open two originals, and relabel one sarcastic post from negative to neutral → Switch the lane to 'Media and analyst' to compare the press framing, then take the wording to the reply meeting

**Family principal (Mukesh, Akash or Isha Ambani)**: A two-minute read on a laptop or iPad of what the public is saying about the IPO and about them personally, which they can trust because they can see the source posts.
Flow: Open the dashboard (already signed in on the shared account) → Read the KPI row: 24h volume, headline sentiment split, change against the prior 24h → Glance at the market-context strip: latest GMP and subscription multiples, each with a freshness badge and an 'unofficial' tag → Tap the entity filter on their own name → Tap the top talking point to open topic detail and read its two-line summary and 7-day timeline → Tap a count to see three real posts behind it

**Our analyst / operator (the 'intelligent partner' team)**: Keep the data fresh, relevant and honestly labelled, so the numbers the family sees can be defended.
Flow: Open the Sources page and see that the Apify LinkedIn actor is marked stale after three failed runs → Expand the row to read the last error, then adjust the actor's cadence or input and save → Enter the X tier and bearer token in the X config card once access is granted. The X source switches from the 'Apify fallback' label to 'Full search' → On Settings > Keywords, add a newly trending hashtag and check its match count against the last 24h before saving → On Settings > Topics, promote an Emerging cluster to a named talking point → On the Accuracy page, label the next 20 gold-set posts and check accuracy per language

### Screens

#### Login (page)

The single private entry point. One shared account with a server-side session, and every attempt is logged. Delivers: Single-login access with audit log and no author-level export

```
header: product name and 'Private' label
card: username field, password field, Sign in button
footer: line reading 'Access is logged'
```

States: Loading shows a spinner on the button. Wrong credentials show an inline error. After 5 failures the account locks for 15 minutes with a message, and an expired session redirects here with 'Session expired'.

#### Executive brief (/) (screen)

The one screen the family and strategy team read: active talking points, sentiment, volume, 24h trend and market context. It refreshes itself every 30 seconds from precomputed rollups. Delivers: One-screen executive brief: active talking points, sentiment split, volume, 24h trend; Precomputed 15-minute rollups with client polling every 30 seconds; Entity filter for Mukesh, Akash, Isha and Jio on mentions, not authors; Reach-weighted sentiment with a media and analyst lane toggle; Suspected-coordination flags (near-duplicates, bursts, author concentration); Market-context strip: GMP and subscription series on the sentiment timeline; Click-through evidence drawer behind every number; Seeded 10-topic taxonomy with Emerging and Unclassified buckets

```
header: title, freshness pill showing the oldest source age (e.g. 'Data 4-18 min old'), links to Sources, Settings and Accuracy, sign out
filter bar: entity segmented control (All / Mukesh / Akash / Isha / Jio) and lane toggle (All / Social / Media and analyst), both stored in the URL
KPI row: items in the last 24h, reach-weighted sentiment headline (pos/neu/neg %), change against the prior 24h, low-confidence share, suspected-coordinated count
market strip: latest GMP (INR) and subscription x (retail / NII / QIB / total), each with source, freshness badge and 'unofficial' tag
talking points table, active topics ranked by 24h volume: name, two-line summary, volume with trend arrow, stacked pos/neu/neg bar, low-confidence %, suspected-coordinated count, 24h sparkline
bottom group: Emerging candidates and Unclassified count, each linking to evidence
footer: 'Instagram and LinkedIn are sampled, not representative' and the gold-set accuracy figure
```

States: Empty: 'Collecting: first numbers appear after the first fetch cycle (about 15 min)'. Loading: skeleton rows. A topic with fewer than 30 items shows 'Not enough data (n=12)' instead of a split. If a poll fails, the last good data stays on screen under an amber banner reading 'Could not refresh, showing data as of HH:MM IST'.

#### Topic detail (/topics/[slug]) (page)

One talking point in depth: how its volume and sentiment moved over 7 days next to GMP and subscription, which sources and Ambanis it involves, and whether it looks coordinated. Delivers: One-screen executive brief: active talking points, sentiment split, volume, 24h trend; Market-context strip: GMP and subscription series on the sentiment timeline; Entity filter for Mukesh, Akash, Isha and Jio on mentions, not authors; Reach-weighted sentiment with a media and analyst lane toggle; Suspected-coordination flags (near-duplicates, bursts, author concentration); Click-through evidence drawer behind every number

```
header: back to brief, topic name, two-line summary with its generated-at time
filter bar: the same entity and lane controls, carried over from the brief
timeline: 7 days of hourly stacked volume by sentiment, with a GMP and subscription line on a second axis and a freshness badge
by-source table: source, items 24h, sentiment split, coverage label (sampled / full search)
entity breakdown: mentions of Mukesh, Akash, Isha and Jio, each with a split
coordination panel: near-duplicate clusters, burst buckets and top-author share, each labelled 'suspected' and linked to its posts
top posts: the 10 highest-reach posts in the last 24h, opening in the evidence drawer
```

States: Unknown slug gives a 404 with a link back to the brief. Loading shows a chart skeleton. A topic with no items in 24h shows 'Dormant: last item HH:MM DD Mon' and still shows the 7-day chart. On error the last good data stays with a retry banner.

#### Evidence drawer (other)

A shadcn Sheet that opens from any number. It lists the real posts behind that number and is where labels are corrected. Delivers: Click-through evidence drawer behind every number; Gold set of 200 labelled posts, one-click relabel and accuracy figure; Author data in a separate table, topic-only views by default; Two-stage classification: triage then batched LLM topic, sentiment and entity tagging

```
header: the slice it came from (e.g. 'Valuation, Negative, Last 24h, Social, Isha') and its item count
controls: sort by reach or newest, and a toggle to show suspected-coordinated posts only
list: post cards with source icon, time (IST), original text, one-line English gloss for non-English posts, reach, confidence badge, 'suspected coordinated' tag where it applies, and an 'Open original' link. The author name appears only for media outlets and public figures; otherwise the card reads 'X user', 'Reddit user' and so on
per card: relabel controls for sentiment (3 buttons), topic (select) and entities (multi-select)
footer: Load more
```

States: Empty: 'No posts match this slice'. Loading: card skeletons. On error, an inline retry. A relabel applies at once, shows an Undo toast for 10 seconds, and reverts with an error toast if the save fails.

#### Sources (/sources) (page)

The honest 'real time' panel. It shows and edits each source's polling interval, and shows freshness, health, items, spend and whether the source is sampled. X credentials are filled in here. Delivers: Per-source cadence config with freshness, blind-spot and spend panel; X adapter with config-driven tier and credentials, Apify fallback; Apify Instagram and LinkedIn adapters labelled 'sampled'; Source adapter interface with Tier-1 adapters (YouTube, Reddit, news RSS, web search, IPO portals)

```
header: back to brief, overall freshness, total spend today and over the last 7 days
sources table: name, lane, status (ok / stale / circuit open), last success, next run, interval in minutes (editable inline, with a separate market-hours interval for portals), items 24h, spend today, coverage label
row expand: the last 10 runs with duration, new items, cost and error message
X config card: tier select, bearer token (write-only field), rate-limit fields, and the current mode ('Official API' or 'Apify fallback')
quota card: YouTube units used today out of 10,000
```

States: A source that has never run shows 'Waiting for first run'. Missing credentials show 'Not configured' (X shows 'Apify fallback'). An open circuit shows a red badge with the last error. Invalid saves show inline validation, and a failed page load shows a retry.

#### Settings (/settings) (page)

The operator's controls: tracked keywords, hashtags and entity aliases, the topic taxonomy with Emerging promotion, retention, and the access/audit log. Delivers: Editable tracked-keyword and entity config with seed list (EN, Hindi, Gujarati); Seeded 10-topic taxonomy with Emerging and Unclassified buckets; Single-login access with audit log and no author-level export; Author data in a separate table, topic-only views by default; Legal and compliance review run in parallel, gating person-level views

```
header: back to brief, and tabs for Keywords and entities / Topics / Access and retention
Keywords tab: chip lists for IPO terms, hashtags, entities with aliases (Latin, Devanagari, Gujarati), co-occurrence terms and negative terms; add/remove; a 'Test against last 24h' count; Save, which creates a new config version
Topics tab: the 10 seeded topics with description and example phrases (editable), Emerging candidates with sample posts and Promote / Merge into / Dismiss, and the Unclassified count
Access and retention tab: audit log table (time, action, IP, detail), retention days for raw posts and authors, and a 'Person-level views: Off, pending legal review' row that cannot be changed from the UI
```

States: Loading shows tab skeletons. A save conflict shows 'Config changed since you opened it, reload'. A save error appears inline and keeps the unsaved edits. No Emerging candidates shows 'Nothing new outside the 10 topics'.

#### Accuracy (/accuracy) (page)

Measures how often the classifier is right on Hinglish, Hindi, Gujarati and English posts, using a 200-post gold set, and shows how dashboard corrections feed back into the prompt. Delivers: Gold set of 200 labelled posts, one-click relabel and accuracy figure; Two-stage classification: triage then batched LLM topic, sentiment and entity tagging

```
header: back to brief, overall sentiment and topic accuracy, prompt version and date
breakdown: accuracy per language (EN / Hinglish / Hindi / Gujarati), a 3x3 sentiment confusion matrix, and the sarcasm subset
labelling queue: one post at a time with sentiment, topic and entity buttons, Skip, and progress 'n / 200'
corrections: count of dashboard relabels, and the number currently used as few-shot examples
```

States: Until 200 posts are labelled it shows 'Not measured yet: n of 200 labelled' and no figure. Loading shows skeletons. An error shows a retry. A finished queue shows 'Gold set complete' with a Re-score button after a prompt change.

#### Dashboard API (/api/*) (endpoint)

Session-protected route handlers the UI polls and writes to. Reads come from rollups with short caching so 30-second polling stays cheap. Delivers: Precomputed 15-minute rollups with client polling every 30 seconds; Click-through evidence drawer behind every number; Single-login access with audit log and no author-level export; Per-source cadence config with freshness, blind-spot and spend panel

```
GET /api/brief?entity=&lane= returns KPIs, ranked topics, market strip and freshness, cached 15s
GET /api/topics/:slug/timeline?entity=&lane= returns 7-day hourly series plus market series
GET /api/evidence?topic=&sentiment=&entity=&lane=&window=&cursor= returns post cards with no author handles except media and public figures
POST /api/labels writes a correction or gold label
GET/PATCH /api/config and /api/sources read and write a new config version
```

States: 401 without a session. 400 on bad filters. Responses carry an as_of timestamp and a stale flag per source. On a database error it returns 503, and the client keeps its last data. It has no bulk or CSV route.

### How screens connect

| From | To | Via |
|---|---|---|
| Login | Executive brief (/) | Sign in |
| Executive brief (/) | Topic detail (/topics/[slug]) | Click a talking point row |
| Executive brief (/) | Evidence drawer | Click any KPI, sentiment bar segment, low-confidence %, coordination count or Emerging/Unclassified count |
| Topic detail (/topics/[slug]) | Evidence drawer | Click a timeline bucket, by-source cell, entity count, coordination item or top post |
| Topic detail (/topics/[slug]) | Executive brief (/) | Back link (filters kept in the URL) |
| Executive brief (/) | Sources (/sources) | Click the freshness pill or the Sources link in the header |
| Executive brief (/) | Settings (/settings) | Settings link in the header |
| Executive brief (/) | Accuracy (/accuracy) | Click the accuracy figure in the footer or the header link |
| Evidence drawer | Original post on the source platform | Open original (new tab) |
| Settings (/settings) | Executive brief (/) | Promote an Emerging topic; it appears as a new row on the next poll |
| Executive brief (/), Topic detail, Evidence drawer, Sources | Dashboard API (/api/*) | TanStack Query polling every 30 seconds, plus writes on relabel or save |
| Any page | Login | Sign out or session expiry |

### Data

| Entity | Fields | Relations |
|---|---|---|
| Post | id, source_key, external_id (unique with source_key), url, author_id (FK), lane (social / media), text, lang (en / hinglish / hi / gu / other), published_at, fetched_at, reach_raw jsonb (followers, views, likes, upvotes, comments), reach_score (0-1, normalized per source), content_hash, embedding vector, near_dup_cluster_id, matched_terms[], raw_json | belongs to Author, has many Classification rows, source_key refers to an entry in Config.sources, rolled up into TopicStat15m |
| Author (isolated table) | id, platform, platform_user_id, handle, display_name, followers, kind (media_outlet / public_figure / other), first_seen_at, last_seen_at, delete_after | has many Posts, never joined into UI or API output except when kind is media_outlet or public_figure, used only in aggregate by the author-concentration flag |
| Classification | id, post_id, origin (model / correction / gold), topic_id, sentiment (positive / neutral / negative), entities[] (mukesh / akash / isha / jio), confidence (high / low), gloss_en, model, prompt_version, created_at | belongs to Post and Topic, effective label is the latest correction or gold row, otherwise the latest model row, accuracy is computed only from gold rows compared with model rows, correction rows become few-shot examples |
| Topic | id, slug, name, kind (seed / emerging / unclassified), description, example_phrases[], summary_2line, summary_at, status (active / dormant / dismissed), promoted_at | has many Classification rows, has many TopicStat15m rows, an emerging topic can be promoted to seed or merged into another topic |
| TopicStat15m | bucket_start (15-min, IST), topic_id, entity (all / mukesh / akash / isha / jio), lane (all / social / media), items, pos / neu / neg counts, low_conf count, reach_pos / reach_neu / reach_neg, suspected_coordinated count, burst_flag, top5_author_share | primary key is (bucket_start, topic_id, entity, lane), derived from Post and the effective Classification, read by /api/brief and the timeline; 24h figures are the sum of 96 buckets |
| MarketPoint | id, series (gmp_inr / sub_retail_x / sub_nii_x / sub_qib_x / sub_total_x), value, observed_at, source_key, source_url, fetched_at | written by IPO portal adapters, plotted on the brief strip and the topic timeline, freshness comes from the EventLog fetch runs for its source |
| Config (versioned) | version, saved_at, terms jsonb (ipo_terms, hashtags, entities with aliases, cooccurrence_terms, negative_terms), sources jsonb (per key: enabled, lane, interval_min, market_hours_interval_min, coverage_label, x_tier, rate_limits, creds_ref), retention_days, min_items_for_split (30), person_level_views (false, locked) | the latest version is read by the worker every scheduler tick, each save adds a row and a config_change EventLog entry, secrets are referenced by creds_ref and stored encrypted, never returned by the API |
| EventLog | id, at, kind (fetch_run / login / login_failed / view / relabel / config_change / promote_topic), source_key, status, items_new, cost_usd, duration_ms, error, ip, detail jsonb | append-only, source freshness, health and spend are derived from fetch_run rows, the Settings access log reads the other kinds |

### Architecture

| Part | Runs on | Role |
|---|---|---|
| Next.js web app (App Router, shadcn/ui) | Vercel, Mumbai region (bom1) | Serves the 7 UI surfaces and the /api route handlers. Checks the server-side session on every route, reads rollups and evidence from Postgres with 15-second caching, writes labels and config versions, and logs access to EventLog. |
| Browser client | The executives' and operators' browsers (laptop and iPad, responsive) | TanStack Query polls /api every 30 seconds and keeps the last good data on error. The shadcn Sheet evidence drawer and charts render on the client. |
| Postgres 16 + pgvector | Managed Postgres (Supabase), AWS ap-south-1 Mumbai | The single store for posts, authors, classifications, topics, 15-minute rollups, market points, config versions, the event log and the pg-boss job tables. |
| Scheduler and ingest worker | Long-running Node.js 22 container on Fly.io, Mumbai region | Reads the latest Config every minute and enqueues each source's fetch when its interval is due (portals use the faster market-hours interval 09:15-15:30 IST, Mon-Fri). Runs adapters behind per-source circuit breakers, dedupes on (source_key, external_id), upserts Author and Post rows, and records fetch_run events with cost. |
| Source adapters | Inside the worker | Each adapter implements fetch(since, cursor) and returns NormalizedPost[]. Adapters: X API v2 recent search (tier and token from config; the Apify X actor runs when the token is blank or rate-limited), YouTube Data API v3, Reddit OAuth, Google News and publisher RSS, web-search API (including site:instagram.com and site:linkedin.com discovery), the Apify Instagram and LinkedIn actors (sampled), and the Chittorgarh, InvestorGain and IPOWatch page parsers, which also write MarketPoint rows. |
| Classification stage | Inside the worker; pg-boss job draining every minute | Triage first: script detection, keyword and co-occurrence match, negative-term drop, embedding relevance and near-duplicate clustering. Then batches of 20-50 posts go to a small LLM that returns topic, sentiment, entities, confidence and an English gloss as schema-validated JSON, cached by content hash. Scraped text is wrapped as untrusted data, and low-confidence posts go to Unclassified. |
| Rollup and trust job | Inside the worker, every minute | Recomputes the current and previous 15-minute TopicStat15m buckets for every topic, entity and lane, with reach weighting and suspected-coordination counts (near-duplicates, bursts, author concentration). Refreshes each active topic's two-line summary every 30 minutes, clusters Unclassified posts into Emerging candidates, and runs the retention purge nightly. |
| External providers | Third-party APIs | X API, YouTube Data API v3, Reddit API, the Apify platform, a web-search API, publisher RSS feeds, the IPO portal web pages, and the LLM and multilingual embedding provider. |

### Stack

| Choice | Reason |
|---|---|
| Next.js 15 (App Router) + TypeScript | Required by the brief. Server components and route handlers keep every database query and the session check on the server. |
| shadcn/ui + Tailwind CSS + shadcn Charts (Recharts) | Required by the brief. Charts, Sheet, Table, Tabs and Toggle come from one component set, so the screen is quick to build and consistent. |
| TanStack Query with a 30-second refetch interval | Gives minute-scale 'real time' without streaming infrastructure, and keeps stale data on screen when a poll fails. |
| PostgreSQL 16 + pgvector on Supabase (Mumbai) | Relational tables handle dedupe, joins and rollups, and vectors for near-duplicates and Emerging clustering live in the same store. The India region suits a DPDP-sensitive dataset. |
| Drizzle ORM in a pnpm monorepo (apps/web, apps/worker, packages/db) | One typed schema shared by the web app and the worker, with plain SQL available for the rollup queries. |
| pg-boss job queue on the same Postgres | Scheduled and retryable fetch and classify jobs with no Redis or extra service to run. |
| Node.js 22 worker on Fly.io (Mumbai) | Apify actor runs and batched LLM calls take minutes, which exceeds serverless time limits. One always-on container also keeps the scheduling logic simple. |
| Better Auth with email and password, one seeded user, database sessions | Meets the one-login requirement with server-side sessions, and has a roles plugin if viewer roles are added later. |
| Small fast LLM with JSON-schema output (Claude Haiku class) plus a hosted multilingual embedding model | Handles Hinglish, Hindi and Gujarati topic, sentiment and entity tagging cheaply in batches, with no training data needed. Multilingual embeddings support relevance triage and near-duplicate detection. |
| apify-client, googleapis, rss-parser, cheerio, plain fetch for X and Reddit | Thin official or standard clients, one per adapter, which keeps each source a small replaceable plugin. |

## Plan

### Phase 1: Foundation: schema, worker, config and access

Goal: A deployed, logged-in shell where a standalone worker pulls Tier-1 sources on a configured cadence into one normalized Postgres store, driven by the editable keyword config.

Features:
- Normalized Postgres schema and standalone ingest worker
- Editable tracked-keyword and entity config with seed list (EN, Hindi, Gujarati)
- Source adapter interface with Tier-1 adapters (YouTube, Reddit, news RSS, web search, IPO portals)
- Author data in a separate table, topic-only views by default
- Single-login access with audit log and no author-level export
- Legal and compliance review run in parallel, gating person-level views

Risks:
- API keys and accounts (YouTube, Reddit, web-search API, Apify) do not exist yet. Provisioning is the likeliest schedule blocker.
- Bare 'jio' is a common Hindi word ('live'), so loose keywords will flood the store with noise until co-occurrence rules are tuned.
- IPO portal and publisher terms of service may forbid scraping, and the legal review may shorten retention or narrow sources after data is already stored.
- YouTube's 10,000-unit daily quota caps search.list to roughly one query every 15 minutes unless a quota increase is granted.

### Phase 2: Full coverage and classification

Goal: Every named source flows in, including X, Instagram and LinkedIn, and each item is tagged with topic, sentiment, mentioned entity and confidence, with accuracy measured against a gold set.

Features:
- X adapter with config-driven tier and credentials, Apify fallback
- Apify Instagram and LinkedIn adapters labelled 'sampled'
- Seeded 10-topic taxonomy with Emerging and Unclassified buckets
- Two-stage classification: triage then batched LLM topic, sentiment and entity tagging
- Gold set of 200 labelled posts, one-click relabel and accuracy figure

Risks:
- Apify actors for Instagram, LinkedIn and X break or change output without notice. Circuit breakers must turn a failure into a stale label rather than a pipeline crash.
- Hinglish, Hindi, Gujarati and sarcasm accuracy may be poor, and the gold set needs someone with context to label 200 posts.
- Prompt-injection text in scraped posts could skew labels, so all scraped text is untrusted input.
- X results stay thin through the Apify fallback until the X tier is decided.

### Phase 3: Executive dashboard

Goal: The one-screen brief the family reads: active talking points, sentiment, 24h trend, entity filter and market context, every number clickable to evidence, and honest freshness per source.

Features:
- Precomputed 15-minute rollups with client polling every 30 seconds
- One-screen executive brief: active talking points, sentiment split, volume, 24h trend
- Click-through evidence drawer behind every number
- Entity filter for Mukesh, Akash, Isha and Jio on mentions, not authors
- Per-source cadence config with freshness, blind-spot and spend panel
- Market-context strip: GMP and subscription series on the sentiment timeline

Risks:
- Small sample sizes early on make percentages look authoritative. The 30-item minimum before showing a split must hold.
- The family may expect second-level live data. The freshness panel has to make clear that 'real time' means minutes.
- GMP numbers are unofficial grey-market figures, so a stale or wrong value beside sentiment may be read as fact.

### Phase 4: Trust layer

Goal: Stop noise and manipulation from being read as public opinion, by weighting by reach, separating media from social, and flagging suspected coordination.

Features:
- Reach-weighted sentiment with a media and analyst lane toggle
- Suspected-coordination flags (near-duplicates, bursts, author concentration)

Risks:
- Coordination heuristics can falsely tag genuine outrage as astroturf. Labels must say 'suspected' and link to evidence.
- Reach metrics differ by platform (followers, views, upvotes) and need per-source normalization, which will be rough at first.
- Person-level features stay off until the legal review answers, and that may never happen within the project's life.

## Features

Ranked by the judge. Decision: keep = exists, leave it; improve = exists, change it; add = new; cut = remove or do not build.

| # | Feature | Decision | Impact | Effort | For | Against | Reason |
|---|---|---|---|---|---|---|---|
| 1 | Editable tracked-keyword and entity config with seed list (EN, Hindi, Gujarati) | add | 5 | 1 | engineering, market |  | Developer feedback 7 asks for a concrete, config-editable seed list (full list in assumptions), and engineering's X-cost concern argues for narrow queries. Bare 'jio' also means 'live' in Hindi, so broad terms must co-occur with an IPO term or a named entity, and Jio Financial Services and JioStar are negative keywords. |
| 2 | Single-login access with audit log and no author-level export | add | 4 | 1 | engineering, skeptic, product, market |  | Developer feedback 6 replaces the SSO allowlist and roles from engineering-7 and skeptic-8 with one account. The skeptic's leak argument still keeps a server-side session, an access log, no public routes and no CSV export of author data. |
| 3 | Per-source cadence config with freshness, blind-spot and spend panel | add | 5 | 2 | product, engineering, skeptic, market |  | All four angles merged on this (engineering-2, product-6, skeptic-5, market-7). It answers the brief's 'every x mins' with a per-source interval stored in config and a last-success / items / spend readout, and labels Instagram and LinkedIn 'sampled, not representative'. Per developer feedback 5, spend is tracked but does not limit cadence. |
| 4 | Click-through evidence drawer behind every number | add | 5 | 2 | product, engineering, skeptic, market |  | Product-2 was endorsed by every angle as the trust mechanism. Executives will not act on a score they cannot verify, and the strategy team needs the real wording, source link and reach for each post. The drawer is also where relabelling happens. |
| 5 | Author data in a separate table, topic-only views by default | add | 5 | 2 | skeptic, product, engineering, market |  | This combines skeptic-2 with developer feedback 6 and the brief's 'references to individuals later'. Handles and author metrics live in an isolated authors table, joined by FK and never shown in v1 UI except for media outlets and public figures. Retention is configurable rather than keyed to any IPO date. |
| 6 | Seeded 10-topic taxonomy with Emerging and Unclassified buckets | add | 5 | 2 | product, engineering, skeptic, market | product | Product-3, engineering-3 and market-2 converged on this: stable seeded topics keep trend lines comparable, and an Emerging bucket the team can promote catches surprises. Ten topics is the single resolved size (listed in assumptions). The topic list is unverified against real chatter (market-2), so it stays editable. |
| 7 | X adapter with config-driven tier and credentials, Apify fallback | add | 5 | 2 | engineering, market |  | Per developer feedback 4, the official X recent-search adapter is built now with the tier, bearer token and rate limits read from config. An Apify X scraper actor runs whenever credentials are blank or rate-limited. This removes the engineering and market concern that unknown X access blocks the build. |
| 8 | Legal and compliance review run in parallel, gating person-level views | add | 5 | 2 | skeptic, product | engineering, market | Skeptic-1's SEBI, UPSI and DPDP risk is real, but engineering and market showed that a hard gate before storage stalls the build. Counsel reviews while topic-only collection runs, and decides retention days and whether any person-level view ever ships. |
| 9 | Precomputed 15-minute rollups with client polling every 30 seconds | add | 4 | 2 | engineering, product, skeptic, market |  | Engineering-4 was endorsed by all angles. Ingest is minute-scale, so TanStack Query polling a cached route over topic_stats_15m keeps the page fast without streaming infrastructure. Rollups carry raw count, reach-weighted score and suspected-coordination count side by side. |
| 10 | Entity filter for Mukesh, Akash, Isha and Jio on mentions, not authors | add | 4 | 2 | market, product, engineering, skeptic |  | Market-8 was endorsed by all angles. It gives the person-level slice the brief asks for by filtering on who is mentioned, which avoids profiling the people posting. The role-gated author drill-down is dropped because there is only one account (feedback 6). |
| 11 | Market-context strip: GMP and subscription series on the sentiment timeline | add | 4 | 2 | product, engineering, market | skeptic | Product-8 and market-5 argue the conversation moves with GMP and subscription numbers. This is a cheap scraped number series, polled faster during market hours (feedback 2). The value claim is unverified (market-5). The skeptic's low attack is met by a freshness badge on the series and a check of portal terms before scraping. |
| 12 | Apify Instagram and LinkedIn adapters labelled 'sampled' | add | 4 | 2 | engineering | product, skeptic, market | Developer feedback 1 overrides the product, skeptic, market and engineering cuts: LinkedIn is in v1 through Apify, not site: search. Both adapters sit behind circuit breakers so a broken actor shows one source as stale and never stops the pipeline (engineering-6). They are labelled sampled to meet the skeptic's coverage-bias concern. |
| 13 | Normalized Postgres schema and standalone ingest worker | add | 5 | 3 | engineering, product, skeptic, market |  | Engineering-1 is the base that everything else depends on: posts deduped on (source, external_id), with author FK, lang, reach metrics, raw_json, separate classifications, corrections, topics, topic_assignments and market_series tables, and pgvector. The stack is chosen fresh rather than inherited from influfinder (feedback 8). Raw payloads allow re-classification when prompts or the taxonomy change. |
| 14 | One-screen executive brief: active talking points, sentiment split, volume, 24h trend | add | 5 | 3 | product, engineering, skeptic, market |  | Product-1 is the core deliverable, endorsed by all angles. It shows a ranked list of active talking points with a positive/neutral/negative split, a low-confidence share, volume and a trend arrow comparing the last 24h with the prior 24h, plus a two-line summary per topic. The phase selector is removed per feedback 2, and splits are hidden below 30 items (market's small-sample concern). |
| 15 | Two-stage classification: triage then batched LLM topic, sentiment and entity tagging | add | 5 | 3 | engineering, product, skeptic, market |  | Engineering-3: dedupe, language detection and keyword or embedding relevance triage, then batches of 20-50 items to a small LLM returning topic, sentiment, mentioned entity and confidence as structured JSON, cached by content hash. Low-confidence items go to Unclassified rather than being forced (skeptic-3), and scraped text is treated as untrusted input to resist prompt injection. |
| 16 | Gold set of 200 labelled posts, one-click relabel and accuracy figure | add | 5 | 3 | product, engineering, skeptic, market | product, engineering, market | Merges product-7, engineering-5, skeptic-3 and market-6 at the size most angles sized it: 200 Hinglish, Hindi and Gujarati posts including sarcasm. Accuracy is computed only from the gold set, never from ad-hoc corrections (engineering's attack). Corrections are stored apart from model output and fed back as few-shot examples. Competitor Hinglish handling is unverified (market-6). |
| 17 | Source adapter interface with Tier-1 adapters (YouTube, Reddit, news RSS, web search, IPO portals) | add | 4 | 3 | engineering, product, skeptic, market |  | Engineering-6: one fetch(since, cursor) to NormalizedPost[] interface makes each source a small plugin. Tier 1 covers YouTube Data API v3, Reddit OAuth, Google News and publisher RSS for Mint, ETMarkets, Moneycontrol and Business Standard, a web-search API (including site:instagram.com and site:linkedin.com discovery), and the Chittorgarh, InvestorGain and IPOWatch pages. influfinder is read for ideas only. |
| 18 | Reach-weighted sentiment with a media and analyst lane toggle | add | 4 | 3 | product, skeptic, market, engineering | skeptic, market, product | Product-4, skeptic-6 and market-4 agree that raw counts mislead. Weighting is by reach only; author-type classification is deferred (product's attack). Market's attack on skeptic-6 is resolved with one headline figure plus a Social / Media and analyst / All toggle, so the lanes are never silently blended. The manipulation premise is unverified (market-4). |
| 19 | Suspected-coordination flags (near-duplicates, bursts, author concentration) | add | 4 | 3 | skeptic, engineering, market | product | Skeptic-4 and engineering-8's detection half: near-duplicate embedding clusters, burst timing and share of a topic's posts from few authors appear as 'suspected coordinated' counts on the dashboard. Following product's attack, there is no derived organic percentage. IPO manipulation is plausible but unverified (market-4). |
| 20 | IPO phase selector and calendar-tuned polling | cut | 5 | 2 | market, product, engineering, skeptic |  | Developer feedback 2: the system runs continuously, so nothing depends on IPO open, close or listing dates. The only remaining time-based rule is faster portal polling during NSE market hours. |
| 21 | Spike and negative-shift alerts (email, Slack, WhatsApp) | cut | 4 | 2 | product, market, engineering | engineering, skeptic | Developer feedback 3 removes all alerting, surge emails, floors and cooldowns from v1. This covers product-5, market-3 and the notification half of engineering-8, and it is listed as a later item. |
| 22 | Hard daily spend kill-switch and degrade-to-sampling at cap | cut | 3 | 2 | skeptic, engineering, market |  | Developer feedback 5: assume a high budget and do not let spend limit cadence or sources. Per-source spend tracking stays in the source panel. |
| 23 | SSO allowlist, MFA, viewer roles and screenshot watermarking | cut | 3 | 2 | engineering, skeptic |  | Developer feedback 6: one login for now. The separate authors table keeps the option of adding roles later. |
| 24 | Compliance sign-off as a hard gate before any data is stored | cut | 4 | 2 | skeptic | engineering, market | Engineering and market showed it would stall the build. It is replaced by a parallel review that gates only person-level views and retention. |
| 25 | Forking or copying influfinder code or stack | cut | 2 | 2 |  | market | Developer feedback 8: influfinder serves a different purpose and is reference only. The stack is chosen on its own merits. |
| 26 | Headline 'organic estimate' percentage | cut | 3 | 3 | skeptic, engineering | product | Product's attack: an unvalidated derived percentage would be read by executives as fact. Only 'suspected' counts are shown. |
| 27 | 'Who is driving this' named-author list and author-type weighting | cut | 3 | 3 | product, market | skeptic, market, product | Skeptic and market attacked the named high-reach author view as profiling, and product attacked author-type classification as infeasible in the timeframe. Reach-only weighting ships instead. |
| 28 | Per-individual author profiles and dossiers | cut | 2 | 3 |  | product, engineering, skeptic, market | All four angles cut it as the largest privacy risk for the least value. Author rows are kept so it can be revisited after the legal review. |
| 29 | Reply drafting or strategy suggestions | cut | 3 | 4 |  | engineering, skeptic, market | The brief says the strategy team frames replies and we supply stats. Engineering, skeptic and market flagged compliance risk. |
| 30 | WebSocket/SSE streaming and X filtered stream | cut | 2 | 3 |  | product, engineering, skeptic | Sources are minute-scale polling, so streaming adds infrastructure with no visible gain (product, engineering, skeptic). |
| 31 | Historical backfill beyond 7 days | cut | 2 | 3 |  | product, engineering, skeptic, market | Not asked for, and the dashboard's longest window is 7 days. A one-off 7-day backfill where APIs allow (X recent search, YouTube, RSS) seeds the trend chart. |
| 32 | Bespoke scrapers per brokerage (Emkay, Centrum, Groww) | cut | 2 | 3 |  | engineering | Engineering: post volume is low, so they are covered through news RSS and web search, with a bespoke scraper added only if gaps show. |
| 33 | Auto-discovered clustering as the primary topic view | cut | 2 | 3 |  | market, skeptic | Market and skeptic: unstable cluster names erode executive trust. Clustering only feeds the Emerging bucket. |
| 34 | Custom report builder and export suite | cut | 1 | 3 |  | product | Product: one account and a handful of readers. The dashboard itself is the report. |
| 35 | Custom-trained or fine-tuned sentiment models | cut | 2 | 4 |  | engineering | Engineering: a prompted LLM plus the gold set and few-shot corrections is enough, and there is no labelled corpus to train on. |
| 36 | Per-post sentiment scores to two decimals | cut | 1 | 1 |  | skeptic | Skeptic: false precision on an unvalidated model. Three buckets plus a confidence flag are shown instead. |

## Cut

| Feature | Why |
|---|---|
| IPO phase selector and calendar-tuned polling | Developer feedback 2: the system runs continuously with no dependence on IPO dates. Only portal polling speeds up during NSE market hours. |
| Spike and negative-shift alerts (email, Slack, WhatsApp) | Developer feedback 3: no email or alerts in v1. Floors, cooldowns and delivery channels are removed and listed as a later item. |
| Hard daily spend kill-switch and degrade-to-sampling at cap | Developer feedback 5: assume a high budget. Spend is tracked per source but never throttles cadence or sources. |
| SSO allowlist, MFA, viewer roles and screenshot watermarking | Developer feedback 6: a single login for now. Author data stays in its own table so roles can be added later. |
| Compliance sign-off as a hard gate before any data is stored | Engineering and market showed a blocking gate stalls the build. The review runs in parallel and gates only person-level views and retention. |
| Forking or copying influfinder code or stack | Developer feedback 8: reference only. A different project, so the stack is chosen fresh. |
| Headline 'organic estimate' percentage | Product's attack: an unvalidated derived number would be read as fact. Only 'suspected coordinated' counts are shown. |
| 'Who is driving this' named-author list and author-type weighting | Skeptic and market flagged named high-reach authors as profiling. Product flagged author-type classification as infeasible in days. Reach-only weighting ships. |
| Per-individual author profiles and dossiers | Every angle cut it for privacy and DPDP risk. Author rows are retained so it can be reconsidered after legal review. |
| Reply drafting or strategy suggestions | Not requested. We supply stats, and IPO-context replies carry compliance risk. |
| WebSocket/SSE streaming and X filtered stream | Polling sources make streaming pointless, and the filtered stream is enterprise-tier. |
| Historical backfill beyond 7 days | Not requested, and longer than any dashboard window. A one-off 7-day backfill seeds the trend chart. |
| Bespoke scrapers per brokerage (Emkay, Centrum, Groww) | Low volume. Covered through news RSS and web search unless a gap appears. |
| Auto-discovered clustering as the primary topic view | Unstable names erode trust. Clustering feeds only the Emerging bucket. |
| Custom report builder and export suite | One account, small audience. The dashboard is the report, and author-level export is banned. |
| Custom-trained or fine-tuned sentiment models | No labelled corpus exists. A prompted LLM with gold-set evaluation and few-shot corrections is used instead. |
| Per-post sentiment scores to two decimals | False precision on an unvalidated model. Three buckets plus confidence are shown instead. |

## Open questions

- Which X API access will be bought (pay-per-use, or a legacy tier if still available), and when will the credentials be supplied? Until then X runs only through the Apify fallback.
- Is a 2-15 minute refresh (depending on source) acceptable to the family as 'real time', or do they expect faster for specific sources?
- Which LLM provider and model may receive this content? Is there a data-residency requirement (India region hosting) for posts and author data?
- Who is the legal or compliance contact, and what retention periods and person-level rules will they set (SEBI publicity and UPSI, DPDP)?
- Who holds the single login, and does anyone outside the strategy team (for example our own analysts) need access?
- Who on the client or our side will hand-label the 200-post gold set, and do they read Hindi and Gujarati?
- Should Anant Ambani, Nita Ambani or Reliance Industries leadership be tracked as entities too, or only Mukesh, Akash and Isha?
- Are other Indian languages (Marathi, Tamil, Telugu, Bengali) needed beyond English, Hinglish, Hindi and Gujarati?
- May GMP and subscription figures scraped from Chittorgarh, InvestorGain and IPOWatch be shown on the dashboard, given they are unofficial and the portals' terms are unchecked?
- Which Apify actors and account should be used for Instagram, LinkedIn and X? Is there an existing Apify org to bill?
- Should we apply for a YouTube Data API quota increase above 10,000 units per day?
- What should the 'later' alerts item look like when it is revisited (channel, recipients, thresholds)?

## Assumptions

- Stack, chosen fresh: TypeScript throughout, Next.js App Router with shadcn/ui, Recharts and TanStack Query for the dashboard (on Vercel or a Node host). Postgres with pgvector (Supabase or Neon) through Drizzle ORM. A standalone Node worker on Railway or Fly running pg-boss schedules on the same Postgres, so there is no Redis. Auth.js credentials provider for the single login.
- Classification uses a small, fast LLM (Claude Haiku-class) with structured JSON output, batched 20-50 items per call and cached by content hash. Embeddings are used for relevance triage, near-duplicate detection and Emerging-bucket clustering.
- Cadence, with budget not limiting: X API recent search every 2 min (Apify X fallback every 10 min); Reddit every 5 min; Google News and publisher RSS (Mint, ETMarkets, Moneycontrol, Business Standard, Economic Times, Financial Express) every 5 min; web-search API including site:instagram.com, site:linkedin.com, Groww, Emkay and Centrum queries every 15 min; YouTube search.list every 15 min and commentThreads.list on tracked videos every 15 min, within the 10,000-unit quota; Apify Instagram every 30 min; Apify LinkedIn every 30 min; IPO and GMP portals every 10 min during NSE market hours (09:15-15:30 IST, weekdays) and every 60 min otherwise. All values live in a config table.
- Resolved taxonomy size: exactly 10 seeded topics plus Emerging and Unclassified. The ten: (1) Valuation and price band; (2) GMP and grey market; (3) Subscription and demand (QIB, NII, retail); (4) Allotment and retail access, including the RIL shareholder quota; (5) Listing expectations and listing gains; (6) Ambani family, succession and leadership (Mukesh, Akash, Isha roles); (7) Governance, promoter control and related-party concerns; (8) Telecom business: tariffs, 5G, subscribers, ARPU; (9) Digital, AI and growth story (partnerships, cloud, platforms); (10) Customer experience and service complaints.
- Resolved windows: rollups in 15-minute buckets. The trend arrow compares the last 24h with the previous 24h. The timeline chart shows the last 7 days in hourly points. A topic is 'active' with at least 20 items in the last 24h. A sentiment split is shown only at 30 or more items in the window. All values are configurable.
- Retention is not keyed to any IPO date: raw_json payloads are kept 30 days, normalized post text and author rows 90 days, and rollups and market_series indefinitely. All are configurable pending the legal review.
- Seed entities: 'Jio Platforms', 'Jio Platforms Ltd', 'JPL', 'Jio Platforms IPO', 'Reliance Jio', 'Reliance Jio Infocomm', 'RJIL', 'Jio IPO', 'Reliance Industries', 'RIL', 'Mukesh Ambani', 'Mukesh bhai', 'Akash Ambani', 'Akash M Ambani', 'Isha Ambani', 'Isha Ambani Piramal', 'Ambani family'. We assume Jio Platforms Ltd is the issuer, Reliance Jio Infocomm its telecom subsidiary and brand, and RIL the parent (to verify against the RHP).
- Seed Hindi (Devanagari): 'जियो आईपीओ', 'जियो प्लेटफॉर्म्स', 'रिलायंस जियो', 'मुकेश अंबानी', 'आकाश अंबानी', 'ईशा अंबानी', 'अंबानी', 'आईपीओ', 'ग्रे मार्केट प्रीमियम', 'जीएमपी', 'अलॉटमेंट', 'लिस्टिंग', 'प्राइस बैंड'. Seed Gujarati: 'જિયો આઈપીઓ', 'રિલાયન્સ જિયો', 'જિયો પ્લેટફોર્મ્સ', 'મુકેશ અંબાણી', 'આકાશ અંબાણી', 'ઈશા અંબાણી', 'અંબાણી', 'આઈપીઓ', 'ગ્રે માર્કેટ', 'એલોટમેન્ટ', 'લિસ્ટિંગ'. Hinglish phrases: 'Jio IPO lagau', 'Jio IPO apply karu', 'allotment mila', 'GMP kitna', 'listing gain kitna'.
- Seed hashtags: #JioIPO, #JioPlatformsIPO, #RelianceJioIPO, #JioIPO2026, #JioGMP, #JioListing, #JioAllotment, #RelianceIPO, #RIL, #Ambani, #MukeshAmbani, #AkashAmbani, #IshaAmbani. Seed IPO terms, used only together with a Jio or Ambani entity: GMP, grey market premium, kostak, subject to sauda, price band, lot size, allotment, allotment status, subscription status, subscribed times, QIB, NII, HNI, retail quota, shareholder quota, anchor investors, OFS, offer for sale, DRHP, RHP, valuation, listing price, listing gain, listing day, apply or avoid.
- Negative keywords and matching rules: bare 'jio' or 'जियो' alone does not match because it means 'live' in Hindi; it must appear with IPO, Platforms, Reliance, an Ambani name or an IPO term. 'Jio Financial Services', 'JFS', 'JioStar' and 'JioHotstar' are excluded unless the item also mentions the IPO.
- The dashboard is analytics only. The strategy team writes all replies outside the tool.
- Mukesh, Akash, Isha and Jio filters work on the entity mentioned in the content. Authors are never ranked or listed in v1, except media outlets and public figures shown by name in the evidence drawer.
- Instagram and LinkedIn data from Apify is sampled and is labelled 'sampled, not representative' wherever its numbers appear.
- IPO dates, price band and listing details are not used anywhere in the system. The secondary-source dates from the market angle are context only.
- Polling intervals (the brief's 'every x mins'), all editable in Config:
- X recent search: every 5 min once credentials are set. Until then the Apify X actor runs every 15 min.
- Reddit and news RSS: every 5 min.
- Web-search API: every 15 min.
- YouTube: one combined OR search every 20 min (72 runs x 100 units = 7,200 units), plus comment polling on the top 20 tracked videos every 20 min (about 1,440 units), staying under the 10,000-unit daily quota.
- Apify Instagram and LinkedIn: every 30 min.
- IPO portals: every 5 min during NSE hours (09:15-15:30 IST, Mon-Fri) and every 60 min otherwise.
End-to-end, data is about 5-35 minutes old depending on the source.
- One trend and lookback rule everywhere: the trend arrow and the % change compare the last 24h with the prior 24h. The timeline and the longest window are 7 days, at 15-minute buckets shown hourly. On first run each adapter fetches back as far as its API allows, up to 7 days.
- A talking point is 'active' when it has at least 10 items in the last 24h. Its sentiment split is shown only when it has at least 30 items in the selected slice.
- Taxonomy size is 10 seeded topics plus the Emerging and Unclassified buckets. The seeded topics are:
1. Valuation and price band
2. GMP and listing gains
3. Subscription and allotment (including any RIL shareholder quota)
4. Tariffs, network and customer experience
5. Financials, debt and growth (ARPU, 5G capex, profitability)
6. Ambani family, leadership and succession
7. Governance, disclosures and regulation (SEBI, related-party)
8. Competition and the telecom market (Airtel, Vi, satellite)
9. AI, 5G and tech ambitions
10. Strategic investors and stake sales (Meta, Google, PE, OFS)
All of them are editable.
- Seed keyword list, IPO and company terms (EN), all editable in Config: 'Jio IPO', 'Jio Platforms IPO', 'Reliance Jio IPO', 'JPL IPO', 'Jio Platforms', 'Jio Platforms Ltd', 'Reliance Jio', 'Reliance Jio Infocomm', 'RJIL', 'Jio listing', 'Jio listing date', 'Jio listing gains', 'Jio GMP', 'Jio grey market premium', 'Jio kostak', 'Jio subject to sauda', 'Jio allotment', 'Jio allotment status', 'Jio subscription status', 'Jio price band', 'Jio lot size', 'Jio DRHP', 'Jio RHP', 'Jio anchor investors', 'Jio valuation', 'Jio OFS', 'Jio share price', 'Jio shareholder quota'.
- Seed hashtags: #JioIPO, #JioPlatformsIPO, #RelianceJioIPO, #JioIPOGMP, #JioGMP, #JioListing, #JioIPOAllotment, #JioPlatforms, #RelianceJio. Generic tags (#IPO, #IPOAlert, #GMP, #StockMarketIndia, #RIL, #Reliance) count only when they co-occur with Jio or a named entity.
- Seed entity aliases:
- Mukesh Ambani: 'Mukesh Ambani', 'Mukesh D. Ambani', 'Mukeshbhai', 'मुकेश अंबानी', 'મુકેશ અંબાણી'.
- Akash Ambani: 'Akash Ambani', 'Akash M. Ambani', 'आकाश अंबानी', 'આકાશ અંબાણી'.
- Isha Ambani: 'Isha Ambani', 'Isha Ambani Piramal', 'Isha Piramal', 'ईशा अंबानी', 'ઈશા અંબાણી'.
- Jio (company): 'Jio Platforms', 'Reliance Jio', 'जियो प्लेटफॉर्म्स', 'रिलायंस जियो', 'જિયો પ્લેટફોર્મ્સ', 'રિલાયન્સ જિયો'.
The surname alone ('Ambani', 'अंबानी', 'અંબાણી') counts only together with an IPO term or Jio.
- Seed Hindi, Hinglish and Gujarati IPO terms: 'जियो आईपीओ', 'जियो का आईपीओ', 'जियो आईपीओ जीएमपी', 'आईपीओ अलॉटमेंट', 'लिस्टिंग', 'ग्रे मार्केट प्रीमियम', 'jio ka ipo', 'jio ipo lena chahiye', 'jio ipo allotment kab', 'જિયો આઈપીઓ', 'જિયો IPO', 'આઈપીઓ એલોટમેન્ટ', 'લિસ્ટિંગ'.
Co-occurrence terms that make bare 'Jio', 'जियो', 'જિયો' or 'Reliance' relevant: IPO, आईपीओ, આઈપીઓ, GMP, grey market, listing, allotment, subscription, subscribed, price band, DRHP, RHP, anchor, QIB, NII, HNI, retail quota, lot size, kostak, sauda.
- Seed negative terms, dropped at triage: 'Jio Financial Services', 'JFSL', 'Jio Finance', 'Jio BlackRock', 'JioStar', 'JioHotstar', 'JioCinema', 'JioSaavn', and Hindi phrases where 'jio' means 'live' ('jio aur jeene do', 'khul ke jio', 'जियो और जीने दो') when no co-occurrence term is present.
- Reddit coverage is keyword search plus a watch on r/IndianStockMarket, r/IndiaInvestments, r/StockMarketIndia, r/IndianStreetBets, r/india and r/mumbai. News RSS covers Google News query feeds plus Mint, ETMarkets, Moneycontrol and Business Standard feeds. Groww, Emkay and Centrum commentary comes through news RSS and the web-search API.
- Lanes are assigned by source:
- Media and analyst: news RSS, web-search results from publisher and brokerage domains, IPO portal commentary, and YouTube videos from a configured list of news channels.
- Social: X, Reddit, Instagram, LinkedIn, and other YouTube videos and comments.
The brief defaults to the 'All' lane.
- Reach-weighted sentiment is calculated as follows:
- Each post's reach_score = log10(1 + its main platform metric: followers for X and LinkedIn, views for YouTube, upvotes for Reddit, likes for Instagram), scaled to that source's 95th percentile.
- Media posts get a fixed outlet weight from config.
- Raw counts are always shown beside the weighted figure.
- Suspected-coordination thresholds, all configurable:
- Near-duplicates: embedding cosine of at least 0.95 across 5 or more distinct authors within 60 minutes.
- Bursts: a 15-minute bucket above 4x the trailing 24h median.
- Author concentration: the top 5 authors account for more than 40% of a topic's 24h posts.
All three are shown only as 'suspected' counts.
- Low confidence means the LLM reports low confidence or the post fails schema validation. Such posts go to Unclassified and are counted in the low-confidence share. The LLM also returns a one-line English gloss so executives can read Hindi and Gujarati posts.
- Topic summaries (two lines) are generated by the LLM from the top-reach posts every 30 minutes and show their generated-at time.
- Our analyst team labels the 200-post gold set: a mix of English, Hinglish, Hindi and Gujarati, including sarcasm. The accuracy figure stays hidden until all 200 are labelled. The 20 most recent corrections are used as few-shot examples.
- The single account is shared by the family and the strategy team. It locks for 15 minutes after 5 failed attempts. Sessions expire after 7 days of inactivity.
- Default retention is 90 days for raw posts and author rows, configurable in Settings and not tied to any IPO date. Rollups and market points are kept indefinitely. Counsel's parallel review may shorten retention and decides whether person-level views are ever enabled; until then the flag stays off and locked.
- The X API tier, bearer token and rate limits are unknown and are entered on the Sources page later. Apify accounts are assumed to exist and are used for Instagram, LinkedIn and the X fallback. Budget is assumed high: spend is tracked per source and never throttles anything.
- API keys and accounts (Google Cloud for YouTube, Reddit OAuth app, web-search API, Apify, LLM and embedding provider) are assumed to be provisioned in the first days. A YouTube quota increase is requested but not relied on.
- The IPO portals' and publishers' terms of service are checked before their scrapers are enabled. GMP and subscription values are shown with an 'unofficial' tag and their source link, and are never presented as official exchange data.
- Hosting is Vercel (bom1), Fly.io (Mumbai) and Supabase (ap-south-1), chosen for India-region data. All times are shown in IST. The UI is responsive down to iPad and phone width for the family.
- The Jio IPO's own details (dates, price band, listing) are not needed by the system and are not hard-coded anywhere.
- Alerts and notifications, viewer roles and person-level views are all deferred to later versions.
- All four angles returned proposals and all were rebutted; no missing or silent angles.

## Why these choices

One or two sentences per angle: its position, and the argument that changed the result. Market claims marked unverified were not checked online.

- **Product**: Put a one-screen executive brief with click-through evidence at the centre, on a seeded taxonomy with an Emerging bucket. Its rebuttal stopped a headline 'organic estimate' number and author-type weighting, leaving 'suspected' coordination flags and reach-only weighting.
- **Engineering**: Argued for one Postgres store, a standalone ingest worker with per-source cadence from quota maths, two-stage LLM classification, and client polling over precomputed rollups instead of streaming. That is the architecture the judge adopted.
- **Skeptic**: Pushed for compliance review, topic-only defaults with isolated author data, a measured gold set and coordination flags. Rebuttals turned its hard 'sign-off before storing data' gate into a review run in parallel that gates person-level views only.
- **Market**: Proposed IPO-calendar phasing, alerts and reach and credibility weighting, and supplied the GMP and subscription market context. Calendar phasing and alerts were cut on developer feedback; 4 of its claims are marked "not checked online".

## Run

- Angles present: product, engineering, skeptic, market
- Unverified market claims: 4 (market angle used web search)
- Revisions: 1. Last feedback: LinkedIn in scope via Apify; no IPO-date dependence (always on); no email/alerts for now; X adapter with tier and credentials in config later, Apify confirmed; budget assumed high, kill-switch dropped; single login; judge picks the seed keyword list; influ-finder is reference only (no fork, stack chosen fresh); resolve the taxonomy-size and lookback contradictions.
