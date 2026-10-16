// Chittorgarh portal adapter (02-04). Parsing lives in portal-shared.ts; this file only holds the URLs and quirks.
import { createPortalAdapter, type PortalSpec } from './portal-shared'

export const spec: PortalSpec = {
  key: 'portal_chittorgarh',
  name: 'Chittorgarh',
  domain: 'chittorgarh.com',
  gmpUrl: 'https://www.chittorgarh.com/report/latest-ipo-gmp/56/',
  subscriptionUrl:
    'https://www.chittorgarh.com/report/ipo-subscription-status-live-bidding-data-bse-nse/21/',
  fixtureFile: 'portal_chittorgarh.html',
}

export default createPortalAdapter(spec)
