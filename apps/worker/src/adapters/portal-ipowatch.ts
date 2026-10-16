// IPOWatch portal adapter (02-04). Parsing lives in portal-shared.ts; this file only holds the URLs and quirks.
import { createPortalAdapter, type PortalSpec } from './portal-shared'

export const spec: PortalSpec = {
  key: 'portal_ipowatch',
  name: 'IPOWatch',
  domain: 'ipowatch.in',
  gmpUrl: 'https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/',
  subscriptionUrl: 'https://ipowatch.in/ipo-subscription-status-today/',
  fixtureFile: 'portal_ipowatch.html',
}

export default createPortalAdapter(spec)
