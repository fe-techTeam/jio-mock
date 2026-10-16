// Generated with esbuild from packages/core/src/matcher.ts, DEFAULT_TERMS (config-schema.ts) and seed-topics.ts. Do not edit.
(() => {
  // ../../../../../private/tmp/claude-501/-Users-vatsalmotiani-Documents-Projects-jio-ipo-analysis/75d7d16b-1ef0-4712-9f64-0e855f512628/scratchpad/jio-data-collector/src/types.ts
  var ENTITY_KEYS = ["mukesh", "akash", "isha", "jio"];

  // ../../../../../private/tmp/claude-501/-Users-vatsalmotiani-Documents-Projects-jio-ipo-analysis/75d7d16b-1ef0-4712-9f64-0e855f512628/scratchpad/jio-data-collector/src/matcher.ts
  var MAX_INPUT_CHARS = 2e4;
  var ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
  function normalizeForMatch(s) {
    return s.normalize("NFKC").replace(ZERO_WIDTH, "").toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
  }
  var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  function compileList(entries) {
    const lookup = /* @__PURE__ */ new Map();
    for (const e of entries) {
      const key = normalizeForMatch(e.term);
      if (key && !lookup.has(key)) lookup.set(key, e);
    }
    if (lookup.size === 0) return null;
    const alts = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
    const re = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])(?:${alts.join("|")})(?![\\p{L}\\p{M}\\p{N}])`,
      "giu"
    );
    return { re, lookup };
  }
  function findHits(list, text) {
    if (!list) return [];
    const hits = [];
    for (const m of text.matchAll(list.re)) {
      const info = list.lookup.get(m[0].toLowerCase());
      if (!info || m.index === void 0) continue;
      hits.push({ start: m.index, end: m.index + m[0].length, term: info.term, tag: info.tag });
    }
    return hits;
  }
  var overlaps = (a, b) => a.start < b.end && b.start < a.end;
  function termsInOrder(hits) {
    const out = [];
    for (const h of [...hits].sort((a, b) => a.start - b.start || b.end - a.end)) {
      if (!out.includes(h.term)) out.push(h.term);
    }
    return out;
  }
  var tagged = (terms, tag) => terms.map((term) => ({ term, tag }));
  function compileMatcher(terms) {
    const negatives = compileList(tagged(terms.negative_terms, "negative"));
    const strong = compileList([
      ...tagged(terms.ipo_terms, "ipo_terms"),
      ...tagged(terms.hashtags, "hashtags")
    ]);
    const entityLists = ENTITY_KEYS.map(
      (key) => [key, compileList(tagged(terms.entities[key].aliases, key))]
    );
    const anchors = compileList(terms.anchor_groups.flatMap((g) => tagged(g.terms, g.name)));
    const qualifiers = compileList([
      ...tagged(terms.cooccurrence_terms, "cooccurrence"),
      ...tagged(terms.generic_hashtags, "generic_hashtag")
    ]);
    return (input) => {
      const text = normalizeForMatch(String(input ?? "").slice(0, MAX_INPUT_CHARS));
      const negHits = findHits(negatives, text);
      let masked = text;
      for (const h of negHits) {
        masked = masked.slice(0, h.start) + " ".repeat(h.end - h.start) + masked.slice(h.end);
      }
      const negativeHits = termsInOrder(negHits);
      const strongHits = findHits(strong, masked);
      const entityHits = entityLists.flatMap(([, list]) => findHits(list, masked));
      const anchorHits = findHits(anchors, masked);
      const qualifierHits = findHits(qualifiers, masked).filter(
        (q) => !anchorHits.some((a) => overlaps(a, q))
      );
      let reason;
      let because;
      const anchorGroups = new Set(anchorHits.map((h) => h.tag));
      if (strongHits.length > 0 || entityHits.length > 0) {
        reason = "strong";
        because = [...strongHits, ...entityHits];
      } else if (anchorHits.length > 0 && qualifierHits.length > 0) {
        reason = "anchor_cooccurrence";
        because = [...anchorHits, ...qualifierHits];
      } else if (anchorGroups.size >= 2) {
        reason = "anchor_pair";
        because = anchorHits;
      } else {
        return {
          relevant: false,
          reason: negativeHits.length > 0 ? "negative" : "none",
          matchedTerms: [],
          entities: [],
          negativeHits
        };
      }
      const found = new Set(entityHits.map((h) => h.tag));
      const personHits = entityHits.filter((h) => h.tag !== "jio");
      const jioByStrong = strongHits.some((h) => !personHits.some((p) => overlaps(p, h)));
      const jioByAnchor = reason !== "strong" && anchorGroups.has("jio");
      if (jioByStrong || jioByAnchor) found.add("jio");
      return {
        relevant: true,
        reason,
        matchedTerms: termsInOrder(because),
        entities: ENTITY_KEYS.filter((k) => found.has(k)),
        negativeHits
      };
    };
  }

  // ../../../../../private/tmp/claude-501/-Users-vatsalmotiani-Documents-Projects-jio-ipo-analysis/75d7d16b-1ef0-4712-9f64-0e855f512628/scratchpad/jio-data-collector/src/terms.ts
  var DEFAULT_TERMS = {
    ipo_terms: [
      // EN company and IPO phrases
      "Jio IPO",
      "Jio Platforms IPO",
      "Reliance Jio IPO",
      "JPL IPO",
      "Jio Platforms",
      "Jio Platforms Ltd",
      "Reliance Jio",
      "Reliance Jio Infocomm",
      "RJIL",
      "Jio listing",
      "Jio listing date",
      "Jio listing gains",
      "Jio GMP",
      "Jio grey market premium",
      "Jio kostak",
      "Jio subject to sauda",
      "Jio allotment",
      "Jio allotment status",
      "Jio subscription status",
      "Jio price band",
      "Jio lot size",
      "Jio DRHP",
      "Jio RHP",
      "Jio anchor investors",
      "Jio valuation",
      "Jio OFS",
      "Jio share price",
      "Jio shareholder quota",
      // Hindi
      "\u091C\u093F\u092F\u094B \u0906\u0908\u092A\u0940\u0913",
      "\u091C\u093F\u092F\u094B \u0915\u093E \u0906\u0908\u092A\u0940\u0913",
      "\u091C\u093F\u092F\u094B \u0906\u0908\u092A\u0940\u0913 \u091C\u0940\u090F\u092E\u092A\u0940",
      "\u091C\u093F\u092F\u094B \u092A\u094D\u0932\u0947\u091F\u092B\u0949\u0930\u094D\u092E\u094D\u0938",
      "\u0930\u093F\u0932\u093E\u092F\u0902\u0938 \u091C\u093F\u092F\u094B",
      // Gujarati
      "\u0A9C\u0ABF\u0AAF\u0ACB \u0A86\u0A88\u0AAA\u0AC0\u0A93",
      "\u0A9C\u0ABF\u0AAF\u0ACB IPO",
      "\u0AB0\u0ABF\u0AB2\u0ABE\u0AAF\u0AA8\u0ACD\u0AB8 \u0A9C\u0ABF\u0AAF\u0ACB",
      "\u0A9C\u0ABF\u0AAF\u0ACB \u0AAA\u0ACD\u0AB2\u0AC7\u0A9F\u0AAB\u0ACB\u0AB0\u0ACD\u0AAE\u0ACD\u0AB8",
      // Hinglish
      "Jio IPO lagau",
      "Jio IPO apply karu",
      "jio ka ipo",
      "jio ipo lena chahiye",
      "jio ipo allotment kab"
    ],
    hashtags: [
      "#JioIPO",
      "#JioPlatformsIPO",
      "#RelianceJioIPO",
      "#JioIPO2026",
      "#JioIPOGMP",
      "#JioGMP",
      "#JioListing",
      "#JioAllotment",
      "#JioIPOAllotment",
      "#JioPlatforms",
      "#RelianceJio",
      "#MukeshAmbani",
      "#AkashAmbani",
      "#IshaAmbani"
    ],
    generic_hashtags: [
      "#IPO",
      "#IPOAlert",
      "#GMP",
      "#StockMarketIndia",
      "#RIL",
      "#Reliance",
      "#RelianceIPO",
      "#Ambani"
    ],
    entities: {
      mukesh: {
        label: "Mukesh Ambani",
        aliases: [
          "Mukesh Ambani",
          "Mukesh D. Ambani",
          "Mukesh D Ambani",
          "Mukeshbhai",
          "Mukesh bhai",
          "MukeshAmbani",
          "\u092E\u0941\u0915\u0947\u0936 \u0905\u0902\u092C\u093E\u0928\u0940",
          "\u0AAE\u0AC1\u0A95\u0AC7\u0AB6 \u0A85\u0A82\u0AAC\u0ABE\u0AA3\u0AC0"
        ]
      },
      akash: {
        label: "Akash Ambani",
        aliases: [
          "Akash Ambani",
          "Akash M. Ambani",
          "Akash M Ambani",
          "AkashAmbani",
          "\u0906\u0915\u093E\u0936 \u0905\u0902\u092C\u093E\u0928\u0940",
          "\u0A86\u0A95\u0ABE\u0AB6 \u0A85\u0A82\u0AAC\u0ABE\u0AA3\u0AC0"
        ]
      },
      isha: {
        label: "Isha Ambani",
        aliases: [
          "Isha Ambani",
          "Isha Ambani Piramal",
          "Isha Piramal",
          "IshaAmbani",
          "\u0908\u0936\u093E \u0905\u0902\u092C\u093E\u0928\u0940",
          "\u0A88\u0AB6\u0ABE \u0A85\u0A82\u0AAC\u0ABE\u0AA3\u0AC0"
        ]
      },
      jio: {
        label: "Jio",
        aliases: [
          "Jio Platforms",
          "Jio Platforms Ltd",
          "Reliance Jio",
          "Reliance Jio Infocomm",
          "RJIL",
          "JioPlatforms",
          "RelianceJio",
          "\u091C\u093F\u092F\u094B \u092A\u094D\u0932\u0947\u091F\u092B\u0949\u0930\u094D\u092E\u094D\u0938",
          "\u0930\u093F\u0932\u093E\u092F\u0902\u0938 \u091C\u093F\u092F\u094B",
          "\u0A9C\u0ABF\u0AAF\u0ACB \u0AAA\u0ACD\u0AB2\u0AC7\u0A9F\u0AAB\u0ACB\u0AB0\u0ACD\u0AAE\u0ACD\u0AB8",
          "\u0AB0\u0ABF\u0AB2\u0ABE\u0AAF\u0AA8\u0ACD\u0AB8 \u0A9C\u0ABF\u0AAF\u0ACB"
        ]
      }
    },
    anchor_groups: [
      { name: "jio", terms: ["jio", "\u091C\u093F\u092F\u094B", "\u0A9C\u0ABF\u0AAF\u0ACB", "JPL"] },
      { name: "reliance", terms: ["Reliance", "RIL", "Reliance Industries", "\u0930\u093F\u0932\u093E\u092F\u0902\u0938", "\u0AB0\u0ABF\u0AB2\u0ABE\u0AAF\u0AA8\u0ACD\u0AB8"] },
      { name: "ambani", terms: ["Ambani", "Ambani family", "\u0905\u0902\u092C\u093E\u0928\u0940", "\u0A85\u0A82\u0AAC\u0ABE\u0AA3\u0AC0"] }
    ],
    cooccurrence_terms: [
      // designer list
      "IPO",
      "\u0906\u0908\u092A\u0940\u0913",
      "\u0A86\u0A88\u0AAA\u0AC0\u0A93",
      "GMP",
      "grey market",
      "listing",
      "allotment",
      "subscription",
      "subscribed",
      "price band",
      "DRHP",
      "RHP",
      "anchor",
      "QIB",
      "NII",
      "HNI",
      "retail quota",
      "lot size",
      "kostak",
      "sauda",
      // judge's IPO terms not already above
      "grey market premium",
      "subject to sauda",
      "allotment status",
      "subscription status",
      "subscribed times",
      "shareholder quota",
      "anchor investors",
      "OFS",
      "offer for sale",
      "valuation",
      "listing price",
      "listing gain",
      "listing day",
      "apply or avoid",
      // Hindi, Gujarati and Hinglish IPO terms
      "\u091C\u0940\u090F\u092E\u092A\u0940",
      "\u0917\u094D\u0930\u0947 \u092E\u093E\u0930\u094D\u0915\u0947\u091F \u092A\u094D\u0930\u0940\u092E\u093F\u092F\u092E",
      "\u0905\u0932\u0949\u091F\u092E\u0947\u0902\u091F",
      "\u0932\u093F\u0938\u094D\u091F\u093F\u0902\u0917",
      "\u092A\u094D\u0930\u093E\u0907\u0938 \u092C\u0948\u0902\u0921",
      "\u0906\u0908\u092A\u0940\u0913 \u0905\u0932\u0949\u091F\u092E\u0947\u0902\u091F",
      "\u0A97\u0ACD\u0AB0\u0AC7 \u0AAE\u0ABE\u0AB0\u0ACD\u0A95\u0AC7\u0A9F",
      "\u0A8F\u0AB2\u0ACB\u0A9F\u0AAE\u0AC7\u0AA8\u0ACD\u0A9F",
      "\u0A86\u0A88\u0AAA\u0AC0\u0A93 \u0A8F\u0AB2\u0ACB\u0A9F\u0AAE\u0AC7\u0AA8\u0ACD\u0A9F",
      "\u0AB2\u0ABF\u0AB8\u0ACD\u0A9F\u0ABF\u0A82\u0A97",
      "allotment mila",
      "GMP kitna",
      "listing gain kitna"
    ],
    negative_terms: [
      "Jio Financial Services",
      "Jio Financial",
      "JFSL",
      "JFS",
      "Jio Finance",
      "Jio BlackRock",
      "JioBlackRock",
      "JioStar",
      "JioHotstar",
      "JioCinema",
      "JioSaavn",
      "jio aur jeene do",
      "khul ke jio",
      "\u091C\u093F\u092F\u094B \u0914\u0930 \u091C\u0940\u0928\u0947 \u0926\u094B"
    ]
  };

  // ../../../../../private/tmp/claude-501/-Users-vatsalmotiani-Documents-Projects-jio-ipo-analysis/75d7d16b-1ef0-4712-9f64-0e855f512628/scratchpad/seed-topics.ts
  var SEED_TOPICS = [
    {
      slug: "valuation-price-band",
      name: "Valuation and price band",
      kind: "seed",
      description: "Whether the Jio IPO price band and implied valuation look cheap, fair or expensive.",
      examplePhrases: [
        "Jio IPO valuation looks stretched at this price band",
        "Price band is fair compared to Airtel",
        "\u091C\u093F\u092F\u094B \u0906\u0908\u092A\u0940\u0913 \u0915\u093E \u092A\u094D\u0930\u093E\u0907\u0938 \u092C\u0948\u0902\u0921 \u092C\u0939\u0941\u0924 \u092E\u0939\u0902\u0917\u093E \u0939\u0948",
        "\u0A9C\u0ABF\u0AAF\u0ACB \u0A86\u0A88\u0AAA\u0AC0\u0A93\u0AA8\u0AC1\u0A82 \u0AB5\u0AC7\u0AB2\u0ACD\u0AAF\u0AC1\u0A8F\u0AB6\u0AA8 \u0AB5\u0AA7\u0ABE\u0AB0\u0AC7 \u0A9B\u0AC7"
      ]
    },
    {
      slug: "gmp-grey-market",
      name: "GMP and grey market",
      kind: "seed",
      description: "Grey market premium, kostak and subject-to-sauda rates quoted for the Jio IPO.",
      examplePhrases: [
        "Jio GMP kitna chal raha aaj?",
        "Grey market premium crashed overnight",
        "\u091C\u093F\u092F\u094B \u0906\u0908\u092A\u0940\u0913 \u091C\u0940\u090F\u092E\u092A\u0940 120 \u0930\u0941\u092A\u092F\u0947",
        "\u0A9C\u0ABF\u0AAF\u0ACB \u0A86\u0A88\u0AAA\u0AC0\u0A93 \u0A97\u0ACD\u0AB0\u0AC7 \u0AAE\u0ABE\u0AB0\u0ACD\u0A95\u0AC7\u0A9F \u0AAA\u0ACD\u0AB0\u0AC0\u0AAE\u0ABF\u0AAF\u0AAE \u0AB5\u0AA7\u0ACD\u0AAF\u0AC1\u0A82"
      ]
    },
    {
      slug: "subscription-demand",
      name: "Subscription and demand",
      kind: "seed",
      description: "How heavily the issue is subscribed across QIB, NII and retail categories, and investor demand.",
      examplePhrases: [
        "Jio IPO subscribed 5x on day one",
        "QIB portion fully booked, retail lagging",
        "\u0930\u093F\u091F\u0947\u0932 \u0939\u093F\u0938\u094D\u0938\u093E \u0915\u093F\u0924\u0928\u0940 \u092C\u093E\u0930 \u0938\u092C\u094D\u0938\u0915\u094D\u0930\u093E\u0907\u092C \u0939\u0941\u0906?"
      ]
    },
    {
      slug: "allotment-retail-access",
      name: "Allotment and retail access",
      kind: "seed",
      description: "Allotment odds, status checks and retail access, including the RIL shareholder quota.",
      examplePhrases: [
        "Allotment mila kya kisi ko?",
        "Buy RIL shares now to qualify for the shareholder quota",
        "\u091C\u093F\u092F\u094B \u0906\u0908\u092A\u0940\u0913 \u0905\u0932\u0949\u091F\u092E\u0947\u0902\u091F \u0938\u094D\u091F\u0947\u091F\u0938 \u0915\u0948\u0938\u0947 \u091A\u0947\u0915 \u0915\u0930\u0947\u0902",
        "\u0A8F\u0AB2\u0ACB\u0A9F\u0AAE\u0AC7\u0AA8\u0ACD\u0A9F \u0AA8\u0ABE \u0AAE\u0AB3\u0ACD\u0AAF\u0AC1\u0A82"
      ]
    },
    {
      slug: "listing-expectations",
      name: "Listing expectations and listing gains",
      kind: "seed",
      description: "Expected listing price, listing-day gains or losses, and whether to hold or sell.",
      examplePhrases: [
        "Expecting 30% listing gains on Jio",
        "Listing gain kitna hoga?",
        "\u0932\u093F\u0938\u094D\u091F\u093F\u0902\u0917 \u0915\u0947 \u0926\u093F\u0928 \u092C\u0947\u091A \u0926\u0942\u0902\u0917\u093E",
        "\u0AB2\u0ABF\u0AB8\u0ACD\u0A9F\u0ABF\u0A82\u0A97 \u0A97\u0AC7\u0A87\u0AA8 \u0AB8\u0ABE\u0AB0\u0ACB \u0AB0\u0AB9\u0AC7\u0AB6\u0AC7"
      ]
    },
    {
      slug: "ambani-family-leadership",
      name: "Ambani family, succession and leadership",
      kind: "seed",
      description: "Roles of Mukesh, Akash and Isha Ambani, succession at Reliance and leadership of Jio.",
      examplePhrases: [
        "Akash Ambani will lead Jio after listing",
        "Mukesh Ambani speech at the AGM about the IPO",
        "\u092E\u0941\u0915\u0947\u0936 \u0905\u0902\u092C\u093E\u0928\u0940 \u0928\u0947 \u0906\u0915\u093E\u0936 \u0915\u094B \u0915\u092E\u093E\u0928 \u0938\u094C\u0902\u092A\u0940",
        "\u0A88\u0AB6\u0ABE \u0A85\u0A82\u0AAC\u0ABE\u0AA3\u0AC0\u0AA8\u0AC0 \u0AAD\u0AC2\u0AAE\u0ABF\u0A95\u0ABE \u0AB6\u0AC1\u0A82 \u0A9B\u0AC7"
      ]
    },
    {
      slug: "governance-promoter-control",
      name: "Governance, promoter control and related-party concerns",
      kind: "seed",
      description: "Promoter control, related-party transactions with Reliance, disclosures and regulatory concerns.",
      examplePhrases: [
        "Too many related-party deals between RIL and Jio",
        "Promoter holding stays too high after the IPO",
        "\u091C\u093F\u092F\u094B \u092E\u0947\u0902 \u0917\u0935\u0930\u094D\u0928\u0947\u0902\u0938 \u0915\u094B \u0932\u0947\u0915\u0930 \u0938\u0935\u093E\u0932"
      ]
    },
    {
      slug: "telecom-business",
      name: "Telecom business: tariffs, 5G, subscribers, ARPU",
      kind: "seed",
      description: "Jio telecom fundamentals: tariff hikes, 5G rollout, subscriber growth and ARPU.",
      examplePhrases: [
        "Tariff hike before the IPO to pump ARPU",
        "Jio added 3 million subscribers last month",
        "\u0930\u093F\u091A\u093E\u0930\u094D\u091C \u092B\u093F\u0930 \u0938\u0947 \u092E\u0939\u0902\u0917\u093E \u0939\u094B \u0917\u092F\u093E",
        "\u0A9C\u0ABF\u0AAF\u0ACB 5G \u0AA8\u0AC7\u0A9F\u0AB5\u0AB0\u0ACD\u0A95 \u0AB8\u0AB0\u0AB8 \u0A9B\u0AC7"
      ]
    },
    {
      slug: "digital-ai-growth",
      name: "Digital, AI and growth story",
      kind: "seed",
      description: "The growth narrative beyond telecom: AI, cloud, platforms, partnerships and new digital businesses.",
      examplePhrases: [
        "Jio AI cloud is the real story here",
        "Partnerships with Meta and Google drive growth",
        "\u091C\u093F\u092F\u094B \u0915\u093E \u090F\u0906\u0908 \u092A\u094D\u0932\u093E\u0928 \u0917\u0947\u092E \u091A\u0947\u0902\u091C\u0930 \u0939\u0948"
      ]
    },
    {
      slug: "customer-experience",
      name: "Customer experience and service complaints",
      kind: "seed",
      description: "Network quality, outages, customer support and service complaints from Jio users.",
      examplePhrases: [
        "Jio network down again in Mumbai",
        "Customer care never picks up",
        "\u091C\u093F\u092F\u094B \u0915\u093E \u0928\u0947\u091F\u0935\u0930\u094D\u0915 \u092C\u0939\u0941\u0924 \u0916\u0930\u093E\u092C \u0939\u0948",
        "\u0A9C\u0ABF\u0AAF\u0ACB \u0AA8\u0AC7\u0A9F\u0AB5\u0AB0\u0ACD\u0A95 \u0AAC\u0A82\u0AA7 \u0A9B\u0AC7"
      ]
    },
    {
      slug: "emerging",
      name: "Emerging",
      kind: "emerging",
      description: "Relevant posts that fit no seeded topic, clustered to surface new talking points.",
      examplePhrases: []
    },
    {
      slug: "unclassified",
      name: "Unclassified",
      kind: "unclassified",
      description: "Low-confidence or invalid classifications awaiting review.",
      examplePhrases: []
    }
  ];

  // ../../../../../private/tmp/claude-501/-Users-vatsalmotiani-Documents-Projects-jio-ipo-analysis/75d7d16b-1ef0-4712-9f64-0e855f512628/scratchpad/matcher-entry.ts
  globalThis.JioCore = { compileMatcher, normalizeForMatch, DEFAULT_TERMS, SEED_TOPICS };
})();
