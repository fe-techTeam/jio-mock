import { ensureTestDatabase, TEST_DATABASE_URL } from '../src/testing'

export default async function setup() {
  await ensureTestDatabase(TEST_DATABASE_URL)
}
