// Public API of @jio/db. Test helpers live in the separate `@jio/db/testing` subpath.
export { createDb, pingDb, type Db } from './client'
export * as schema from './schema'
export { runMigrations } from './migrate'
export {
  ConfigConflictError,
  ConfigParseError,
  getLatestConfig,
  saveConfigVersion,
  type LatestConfig,
} from './queries/config'
export {
  logEvent,
  loginFailuresSince,
  recentFetchRuns,
  sourceHealth,
  type DbLike,
  type FetchRunRow,
  type NewEvent,
  type SourceHealthRow,
} from './queries/events'
export { listTopicDefs, upsertSeedTopics, type StoredTopicDef } from './queries/topics'
export {
  stripNulJson,
  upsertPosts,
  type UpsertPostsOptions,
  type UpsertPostsResult,
} from './queries/posts'
export { insertMarketPoints, type InsertMarketPointsResult } from './queries/market'
export { seedBase, type SeedResult } from './seed'
