// InvestorGain portal adapter (02-04). Parsing lives in portal-shared.ts; this file only holds the URLs and quirks.
import { createPortalAdapter, type PortalSpec } from './portal-shared'

export const spec: PortalSpec = {
  key: 'portal_investorgain',
  name: 'InvestorGain',
  domain: 'investorgain.com',
  gmpUrl: 'https://www.investorgain.com/report/live-ipo-gmp/331/',
  subscriptionUrl: 'https://www.investorgain.com/report/ipo-subscription-live/333/',
  fixtureFile: 'portal_investorgain.html',
  // InvestorGain labels the issuer column 'Current IPO'.
  overrides: { name: /^current ipo|^ipo name/ },
}

export default createPortalAdapter(spec)
