import { prepareTestDb } from '../src/testing'

// Creates and migrates jio_ipo_test. Other packages call prepareTestDb('jio_ipo_test_<pkg>').
export default async function setup() {
  await prepareTestDb()
}
