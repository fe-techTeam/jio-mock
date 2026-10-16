// Resolved taxonomy (design resolutions): 10 seeded topics plus the Emerging and Unclassified
// buckets. All are editable once seeded; 01-02 inserts them on conflict (slug) do nothing.
import type { TopicDef } from './types'

export const SEED_TOPICS: TopicDef[] = [
  {
    slug: 'valuation-price-band',
    name: 'Valuation and price band',
    kind: 'seed',
    description:
      'Whether the Jio IPO price band and implied valuation look cheap, fair or expensive.',
    examplePhrases: [
      'Jio IPO valuation looks stretched at this price band',
      'Price band is fair compared to Airtel',
      'जियो आईपीओ का प्राइस बैंड बहुत महंगा है',
      'જિયો આઈપીઓનું વેલ્યુએશન વધારે છે',
    ],
  },
  {
    slug: 'gmp-grey-market',
    name: 'GMP and grey market',
    kind: 'seed',
    description: 'Grey market premium, kostak and subject-to-sauda rates quoted for the Jio IPO.',
    examplePhrases: [
      'Jio GMP kitna chal raha aaj?',
      'Grey market premium crashed overnight',
      'जियो आईपीओ जीएमपी 120 रुपये',
      'જિયો આઈપીઓ ગ્રે માર્કેટ પ્રીમિયમ વધ્યું',
    ],
  },
  {
    slug: 'subscription-demand',
    name: 'Subscription and demand',
    kind: 'seed',
    description:
      'How heavily the issue is subscribed across QIB, NII and retail categories, and investor demand.',
    examplePhrases: [
      'Jio IPO subscribed 5x on day one',
      'QIB portion fully booked, retail lagging',
      'रिटेल हिस्सा कितनी बार सब्सक्राइब हुआ?',
    ],
  },
  {
    slug: 'allotment-retail-access',
    name: 'Allotment and retail access',
    kind: 'seed',
    description:
      'Allotment odds, status checks and retail access, including the RIL shareholder quota.',
    examplePhrases: [
      'Allotment mila kya kisi ko?',
      'Buy RIL shares now to qualify for the shareholder quota',
      'जियो आईपीओ अलॉटमेंट स्टेटस कैसे चेक करें',
      'એલોટમેન્ટ ના મળ્યું',
    ],
  },
  {
    slug: 'listing-expectations',
    name: 'Listing expectations and listing gains',
    kind: 'seed',
    description:
      'Expected listing price, listing-day gains or losses, and whether to hold or sell.',
    examplePhrases: [
      'Expecting 30% listing gains on Jio',
      'Listing gain kitna hoga?',
      'लिस्टिंग के दिन बेच दूंगा',
      'લિસ્ટિંગ ગેઇન સારો રહેશે',
    ],
  },
  {
    slug: 'ambani-family-leadership',
    name: 'Ambani family, succession and leadership',
    kind: 'seed',
    description:
      'Roles of Mukesh, Akash and Isha Ambani, succession at Reliance and leadership of Jio.',
    examplePhrases: [
      'Akash Ambani will lead Jio after listing',
      'Mukesh Ambani speech at the AGM about the IPO',
      'मुकेश अंबानी ने आकाश को कमान सौंपी',
      'ઈશા અંબાણીની ભૂમિકા શું છે',
    ],
  },
  {
    slug: 'governance-promoter-control',
    name: 'Governance, promoter control and related-party concerns',
    kind: 'seed',
    description:
      'Promoter control, related-party transactions with Reliance, disclosures and regulatory concerns.',
    examplePhrases: [
      'Too many related-party deals between RIL and Jio',
      'Promoter holding stays too high after the IPO',
      'जियो में गवर्नेंस को लेकर सवाल',
    ],
  },
  {
    slug: 'telecom-business',
    name: 'Telecom business: tariffs, 5G, subscribers, ARPU',
    kind: 'seed',
    description: 'Jio telecom fundamentals: tariff hikes, 5G rollout, subscriber growth and ARPU.',
    examplePhrases: [
      'Tariff hike before the IPO to pump ARPU',
      'Jio added 3 million subscribers last month',
      'रिचार्ज फिर से महंगा हो गया',
      'જિયો 5G નેટવર્ક સરસ છે',
    ],
  },
  {
    slug: 'digital-ai-growth',
    name: 'Digital, AI and growth story',
    kind: 'seed',
    description:
      'The growth narrative beyond telecom: AI, cloud, platforms, partnerships and new digital businesses.',
    examplePhrases: [
      'Jio AI cloud is the real story here',
      'Partnerships with Meta and Google drive growth',
      'जियो का एआई प्लान गेम चेंजर है',
    ],
  },
  {
    slug: 'customer-experience',
    name: 'Customer experience and service complaints',
    kind: 'seed',
    description:
      'Network quality, outages, customer support and service complaints from Jio users.',
    examplePhrases: [
      'Jio network down again in Mumbai',
      'Customer care never picks up',
      'जियो का नेटवर्क बहुत खराब है',
      'જિયો નેટવર્ક બંધ છે',
    ],
  },
  {
    slug: 'emerging',
    name: 'Emerging',
    kind: 'emerging',
    description:
      'Relevant posts that fit no seeded topic, clustered to surface new talking points.',
    examplePhrases: [],
  },
  {
    slug: 'unclassified',
    name: 'Unclassified',
    kind: 'unclassified',
    description: 'Low-confidence or invalid classifications awaiting review.',
    examplePhrases: [],
  },
]
