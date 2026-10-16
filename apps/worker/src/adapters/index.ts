// Adapter registry. Wave-2 plans replace the bodies of the adapter files and never edit this file.
import type { SourceAdapter, SourceKey } from '@jio/core'
import apifyInstagram from './apify-instagram'
import apifyLinkedin from './apify-linkedin'
import newsRss from './news-rss'
import portalChittorgarh from './portal-chittorgarh'
import portalInvestorgain from './portal-investorgain'
import portalIpowatch from './portal-ipowatch'
import reddit from './reddit'
import webSearch from './web-search'
import xApi from './x-api'
import xApify from './x-apify'
import youtube from './youtube'

export const ADAPTERS: Record<SourceKey, SourceAdapter> = {
  x_api: xApi,
  x_apify: xApify,
  youtube,
  reddit,
  news_rss: newsRss,
  web_search: webSearch,
  apify_instagram: apifyInstagram,
  apify_linkedin: apifyLinkedin,
  portal_chittorgarh: portalChittorgarh,
  portal_investorgain: portalInvestorgain,
  portal_ipowatch: portalIpowatch,
}
