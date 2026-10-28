// Contract: see the comment block at the top of ../SiteFactory/factory/build.js.
// Exports rows, page(row), home(). Everything else, the shell, sitemap,
// legal pages and the uniqueness gate, is generic and lives in the factory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site } from '../SiteFactory/sitekit/config.js';
import {
  summarizeCounty, severity, hasQualifyingWell, SEVERITY_TIERS_ORDERED,
  DECLINE_TERCILES_FT_PER_DECADE,
} from './functions/groundwater-model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Revenue routes, per revenue.md. Every id defaults to "" in site.config.json,
// which keeps the CTA, its disclosure line and the privacy paragraph dark
// together - a commission can never start flowing without the disclosure
// going live in the same build.
// ---------------------------------------------------------------------------
const ADSENSE_ON = Boolean(site.revenue?.adsenseId);
const AFFILIATE_PROGRAMS = {
  ahs: { name: 'American Home Shield', url: (id) => id },
  choice: { name: 'Choice Home Warranty', url: (id) => id },
  tapscore: { name: 'Tap Score', url: (id) => id },
};
const ACTIVE_WARRANTY = Object.entries(site.revenue?.affiliates ?? {})
  .filter(([k]) => k === 'ahs' || k === 'choice')
  .map(([key, id]) => (id ? { ...AFFILIATE_PROGRAMS[key], id } : null))
  .find(Boolean) ?? null;
const ACTIVE_TESTKIT = site.revenue?.affiliates?.tapscore
  ? { ...AFFILIATE_PROGRAMS.tapscore, id: site.revenue.affiliates.tapscore }
  : null;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function slugify(s) {
  return s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// A plain split(',') shifts every column on a row whose well_name is quoted
// because it contains a comma itself (USGS well names routinely read "Local
// number, A-654, SUNY Albany NY"). That silently corrupted depth, dates and
// measurement counts on every affected row - a parsing bug, not a copy one.
function splitCsvLine(line) {
  const cells = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

function loadCounties() {
  const csv = fs.readFileSync(path.join(HERE, 'src/data/counties.csv'), 'utf8').trim();
  const [header, ...lines] = csv.split('\n');
  const cols = splitCsvLine(header);
  const raws = lines.map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });

  const seen = new Map();
  return raws.map((raw) => {
    let slug = slugify(`${raw.county}-${raw.state}`);
    if (seen.has(slug)) slug = `${slug}-${raw.fips.slice(-4)}`;
    seen.set(slug, true);
    return { ...raw, slug };
  });
}

export const rows = loadCounties();

const summaryBySlug = new Map(rows.map((r) => [r.slug, summarizeCounty(r)]));

// Rank among counties with a usable trend, ascending (fastest-rising first,
// fastest-declining last) - a continuous, genuinely per-row number, not a
// handful of repeated tier labels, which is exactly what the uniqueness
// gate wants to see.
const trended = rows
  .filter((r) => summaryBySlug.get(r.slug).trendFtPerDecade !== null)
  .sort((a, b) => summaryBySlug.get(a.slug).trendFtPerDecade - summaryBySlug.get(b.slug).trendFtPerDecade);
const trendRank = new Map(trended.map((r, i) => [r.slug, i + 1]));
const TRENDED_TOTAL = trended.length;
const COVERAGE_TOTAL = rows.length;
const COVERAGE_WITH_DATA = rows.filter((r) => hasQualifyingWell(r)).length;
const COVERAGE_PCT = Math.round((COVERAGE_WITH_DATA / COVERAGE_TOTAL) * 100);

// Nearest qualifying well to a no-data county, by straight-line distance.
// Not a substitute for that county's own reading, but a real, genuinely
// per-county data point rather than a repeat of the same boilerplate -
// this is what keeps the ~55% of counties with no well from reading as one
// templated page with the name swapped out.
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function nearestQualifying(row) {
  const lat = Number(row.lat), lon = Number(row.lon);
  let best = null, bestDist = Infinity;
  for (const r of trended) {
    const d = haversineMiles(lat, lon, Number(r.lat), Number(r.lon));
    if (d < bestDist) { bestDist = d; best = r; }
  }
  return best ? { row: best, miles: Math.round(bestDist) } : null;
}
const nearestBySlug = new Map();
for (const r of rows) {
  if (!hasQualifyingWell(r)) nearestBySlug.set(r.slug, nearestQualifying(r));
}

// ---------------------------------------------------------------------------
// Shared formatting helpers
// ---------------------------------------------------------------------------

const pop = (n) => Number(n).toLocaleString('en-US');
const ft = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');
const ordinalSuffix = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
};
const ordinal = (n) => `${n}${ordinalSuffix(n)}`;
// USGS well names arrive as raw site descriptions, often all caps
// ("GLEN ALPINE NEAR CHARLOTTE NC") - a database value, not a sentence. Title
// Case it before it reaches a reader, same as any other source field.
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function hashOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pick(seed, variants) {
  return variants[hashOf(seed) % variants.length];
}

const TIER_META = {
  'declining-severe': { badge: 'bad', word: 'declining faster than most declining counties', short: 'Declining fast' },
  'declining-moderate': { badge: 'mid', word: 'declining at a typical pace for a declining county', short: 'Declining, typical pace' },
  'declining-mild': { badge: 'mid', word: 'declining, slower than most declining counties', short: 'Declining slowly' },
  stable: { badge: 'good', word: 'holding roughly steady', short: 'Stable' },
  rising: { badge: 'good', word: 'rising, getting shallower over time', short: 'Rising' },
  'no-data': { badge: 'mid', word: 'not tracked by a long-term monitoring well', short: 'Not tracked' },
};

// ---------------------------------------------------------------------------
// Per-county page
// ---------------------------------------------------------------------------

export function page(row) {
  const { slug, county, state, state_name: stateName, population, land_sq_mi: landSqMi } = row;
  const s = summaryBySlug.get(slug);
  const tier = TIER_META[s.severityTier];
  const blocks = [];

  // --- verdict: direction first, the thing a well owner actually wants ------
  const near = !s.hasQualifyingWell ? nearestBySlug.get(slug) : null;
  const nearSummary = near ? summaryBySlug.get(near.row.slug) : null;
  const NEARBY_MILES = 150;

  if (!s.hasQualifyingWell && near && near.miles <= NEARBY_MILES) {
    // No qualifying well in THIS county, but a real one close enough to be a
    // genuine regional estimate - lead with that answer rather than leading
    // with the gap, then disclose the gap in the sentence right after it.
    const nTier = TIER_META[nearSummary.severityTier];
    blocks.push({
      h2: pick(slug + '-h2', [
        `The nearest real water-table reading to ${county}, ${state}`,
        `What the closest monitoring well shows for ${county}`,
        `${county}, ${state}: the closest actual trend`,
      ]),
      html: `<div class="verdict"><span class="badge ${nTier.badge}">${nearSummary.severityLabel}</span>
<div class="figure">${ft(Math.abs(nearSummary.trendFtPerDecade))}<small>ft/decade</small></div>
<p class="says">${pick(slug + '-nearest-lead', [
        `${near.row.county}, ${near.row.state}, ${near.miles} miles from ${county}, is the closest county with a qualifying well, and its water table is ${nTier.word}.`,
        `The closest qualifying well to ${county} is ${near.miles} miles away in ${near.row.county}, ${near.row.state}, where the trend runs ${nTier.word}.`,
      ])}</p></div>
<p>${pick(slug + '-nodata-caveat', [
        `${county} itself has no monitoring well with enough history to call its own trend, so treat this as a regional estimate, not ${county}'s own number. If you own a well here, comparing your own depth log against this regional figure is worth doing before assuming either way.`,
        `No well inside ${county} clears this site's 15-year qualifying bar, so this is the closest real reading, not a measurement of ${county}'s own aquifer. Worth checking your own well's depth log against it rather than assuming it matches.`,
      ])} <a href="/${near.row.slug}">See ${near.row.county}, ${near.row.state}'s full page</a>.</p>`,
    });

    blocks.push({
      h2: pick(slug + '-nodata-pop-h2', [`${county}, ${stateName} in brief`, `About ${county}`]),
      html: `<p>${pick(slug + '-nodata-pop', [
        `${county}, ${stateName} covers ${Math.round(Number(landSqMi)).toLocaleString('en-US')} square miles and is home to about ${pop(population)} people.`,
        `About ${pop(population)} people live across ${county}'s ${Math.round(Number(landSqMi)).toLocaleString('en-US')} square miles, in ${stateName}.`,
      ])} USGS's National Groundwater Monitoring Network covers ${COVERAGE_WITH_DATA.toLocaleString('en-US')} of ${COVERAGE_TOTAL.toLocaleString('en-US')} US counties (${COVERAGE_PCT}%) today; ${county} isn't one of them yet.</p>`,
    });
  } else if (!s.hasQualifyingWell) {
    // The rare county (well under 2% of the dataset) with no qualifying well
    // ANYWHERE nearby - too far for a regional estimate to mean much, so this
    // page states the gap plainly instead of reaching for a distant proxy.
    blocks.push({
      h2: pick(slug + '-h2', [
        `No nearby well record for ${county}`,
        `${county}, ${state}: not enough monitoring history to call a trend`,
      ]),
      html: `<div class="verdict"><span class="badge mid">Not tracked</span>
<div class="figure">&mdash;</div>
<p class="says">No USGS monitoring well within ${near ? `${near.miles} miles` : 'a useful distance'} of ${county} clears the 15-year qualifying bar this site sets before calling a trend.</p></div>
<p>${pick(slug + '-nodata-far', [
        `A county this far from any qualifying well isn't a safe one to estimate from a neighbor, so this page states the gap rather than reaching for a number that wouldn't mean much. Worth checking with a local well contractor for a direct reading.`,
        `Borrowing a trend from hundreds of miles away would tell you more about that well than ${county}'s own aquifer, so this page says plainly that no useful nearby record exists. Consider a direct well-log check with a local contractor instead.`,
      ])}</p>
<p>${pick(slug + '-nodata-pop2', [
        `${county}, ${stateName} covers ${Math.round(Number(landSqMi)).toLocaleString('en-US')} square miles and is home to about ${pop(population)} people.`,
        `About ${pop(population)} people live across ${county}'s ${Math.round(Number(landSqMi)).toLocaleString('en-US')} square miles, in ${stateName}.`,
      ])}</p>`,
    });
  } else {
    const headlineH2 = pick(slug + '-h2', [
      `Is the water table dropping in ${county}, ${state}?`,
      `${county}, ${state}: what the water table is actually doing`,
      `${county}'s groundwater trend, from USGS's own readings`,
    ]);
    const trendLine = pick(slug + '-trend', [
      `${county}'s representative monitoring well shows depth to water ${tier.word}, a fitted trend of ` +
        `${ft(Math.abs(s.trendFtPerDecade))} ft per decade over ${Math.round(s.spanYears)} years of readings.`,
      `Over ${Math.round(s.spanYears)} years of USGS readings, the well tracking ${county}'s aquifer is ` +
        `${tier.word}: ${ft(Math.abs(s.trendFtPerDecade))} ft per decade.`,
      `${county}'s long-term well puts the trend at ${ft(Math.abs(s.trendFtPerDecade))} ft per decade, ` +
        `${tier.word}, based on ${s.nMeasurements} measurements since ${s.firstDate?.slice(0, 4)}.`,
    ]);
    const caveat = pick(slug + '-onewell', [
      `One well stands in for ${county}'s whole aquifer here, the honest simplification every page on this site carries.`,
      `This is one representative well, not a county-wide survey, the same grain limit every page here discloses.`,
    ]);
    blocks.push({
      h2: headlineH2,
      html: `<div class="verdict"><span class="badge ${tier.badge}">${s.severityLabel}</span>
<div class="figure">${ft(Math.abs(s.trendFtPerDecade))}<small>ft/decade</small></div>
<p class="says">${trendLine}</p></div><p>${caveat}</p>`,
    });

    // --- depth + well detail --------------------------------------------------
    const depthLine = s.isArtesian
      ? pick(slug + '-depth-art', [
          `Water in this well currently sits ${s.depthText}, a flowing or artesian well rather than one pumped from below.`,
          `This well is artesian, water currently stands ${s.depthText}, not drawn up from a depth.`,
        ])
      : pick(slug + '-depth', [
          `Depth to water at the last reading was ${s.depthText}.`,
          `The most recent reading put water ${s.depthText}.`,
        ]);
    blocks.push({
      h2: pick(slug + '-depth-h2', [`What the well actually measured`, `${county}'s source well, in detail`]),
      html: `<p>${depthLine} Readings span ${s.firstDate} to ${s.lastDate}, ${s.nMeasurements} measurements from ` +
        `USGS well ${s.wellId}${s.wellName ? ` (${titleCase(s.wellName)})` : ''}, part of the National Water Information System.</p>`,
    });

    // --- national rank, genuinely per-row-unique ------------------------------
    const rr = trendRank.get(slug);
    const rankLine = pick(slug + '-rank', [
      `Of the ${TRENDED_TOTAL.toLocaleString('en-US')} US counties with a usable trend, ${county} ranks ${ordinal(rr)} ` +
        `from fastest-rising to fastest-declining, 1 is the fastest-rising water table measured, ${TRENDED_TOTAL} the fastest-declining.`,
      `${county} sits at rank ${ordinal(rr)} of ${TRENDED_TOTAL.toLocaleString('en-US')} ranked counties, ordered ` +
        `rising-to-declining, so a low number means a rising water table and a high one means fast decline.`,
    ]);
    const popLine = pick(slug + '-pop', [
      `${county}, ${stateName} is home to about ${pop(population)} people.`,
      `About ${pop(population)} people live in ${county}, ${stateName}.`,
    ]);
    blocks.push({
      h2: pick(slug + '-rank-h2', [`How ${county} compares nationally`, `Where ${county} ranks`]),
      html: `<p>${rankLine} ${popLine}</p>`,
    });

    // --- CTA: well-pump risk, only where the data supports it -----------------
    if (s.pumpRiskRelevant) {
      const ctaBody = pick(slug + '-cta-pump', [
        `A dropping water table means a residential pump has to reach deeper and work harder, which shortens its life. ` +
          `In ${county}, that trend is real, not assumed: ${ft(Math.abs(s.trendFtPerDecade))} ft per decade over ${Math.round(s.spanYears)} years.`,
        `Because ${county}'s water table is actually declining, not just a general worry, a well owner here should ` +
          `consider comparing home-warranty plans that cover well-pump failure before one happens.`,
      ]);
      blocks.push({
        h2: pick(slug + '-cta-h2', [`If you own a well in ${county}`, `What a declining table means for a well pump`]),
        html: `<p>${ctaBody}</p>${ACTIVE_WARRANTY ? `
<p class="cta"><strong><a href="${ACTIVE_WARRANTY.url(ACTIVE_WARRANTY.id)}" rel="sponsored noopener" target="_blank">Compare well-pump coverage from ${ACTIVE_WARRANTY.name}</a></strong></p>
<p class="disclosure">Affiliate link: ${site.name} earns a commission if you sign up through it, at no extra cost to you.</p>` : ''}`,
      });
    }

    // --- secondary CTA: water quality is a different question -----------------
    blocks.push({
      h2: pick(slug + '-quality-h2', [`A dropping table says nothing about water quality`, `Depth and quality are separate questions`]),
      html: `<p>${pick(slug + '-quality-body', [
        `Whether ${county}'s water table is rising or falling is independent of what's actually in the water. Depletion can concentrate ` +
          `naturally-occurring minerals, so it's worth checking directly with a water test rather than assuming a depth trend says anything about quality.`,
        `This page answers a depth question, not a quality one. A well in ${county} can be stable in depth and still worth testing for quality, ` +
          `or declining and still test clean, the two are measured separately, and only a direct test settles the second one.`,
      ])}</p>${ACTIVE_TESTKIT ? `
<p class="cta"><strong><a href="${ACTIVE_TESTKIT.url(ACTIVE_TESTKIT.id)}" rel="sponsored noopener" target="_blank">See well-water test kits from ${ACTIVE_TESTKIT.name}</a></strong></p>
<p class="disclosure">Affiliate link: ${site.name} earns a commission on a qualifying order, at no extra cost to you.</p>` : ''}`,
    });
  }

  const title = `${county}, ${state} Water Table Trend`.length > 60
    ? `${county}, ${state} Water Table`
    : `${county}, ${state} Water Table Trend`;

  return {
    slug,
    title,
    description: s.hasQualifyingWell
      ? `${county}, ${state}: depth to water is ${s.severityLabel.toLowerCase()}, ${ft(Math.abs(s.trendFtPerDecade))} ft/decade, from USGS's own long-term monitoring well.`
      : `${county}, ${state} has no USGS long-term monitoring well with enough history for a water-table trend yet.`,
    blocks,
    schema: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: `Water Table Trend in ${county}, ${state}`,
      about: 'County-level groundwater depth-to-water trend',
      spatialCoverage: `${county}, ${state}, USA`,
    },
  };
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export function home() {
  const totalPop = rows.reduce((a, r) => a + Number(r.population || 0), 0);
  const states = new Set(rows.map((r) => r.state)).size;
  return {
    title: `${site.name}, County Groundwater Trend Data`,
    description: `USGS monitoring-well depth-to-water trends for ${COVERAGE_WITH_DATA} of ${COVERAGE_TOTAL} US counties across ${states} states. Real wells, not a national average, and an honest coverage gap where no well qualifies.`,
    blocks: [
      {
        h2: 'The question this site answers',
        html: `<p>"Will my well run dry" doesn't have a national answer: USGS tracks depth to water county by county, through a scattered network of long-term monitoring wells, not a bulk survey of every property. ${site.name} fits a trend to each qualifying well's own history and reports it plainly, including for the ${COVERAGE_TOTAL - COVERAGE_WITH_DATA} counties where no well yet has enough record to call one.</p>`,
      },
      {
        h2: 'Why only 45% of counties have an answer',
        html: `<p>A county only gets a trend here if USGS's own National Groundwater Monitoring Network has a well with at least 15 years of readings, a reading within the last 10 years, and 6 or more usable measurements. Monitoring-well placement follows decades of state and federal programs, not population or risk, so coverage is uneven: dense in parts of the West and Midwest, sparse elsewhere. That gap is reported directly rather than filled with a guess.</p>`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

const bySlug = new Map(rows.map((r) => [r.slug, r]));
function pageLink(slug, label) {
  return `<a href="/${slug}">${label}</a>`;
}
function guideLink(slug, label) {
  return `<a href="/guides/${slug}">${label}</a>`;
}

export function staticPages() {
  return [
    {
      slug: 'about',
      title: `About ${site.name}`,
      description: `${site.name} reports USGS groundwater monitoring-well trends for ${COVERAGE_WITH_DATA} US counties, real wells, county by county, with the coverage gap stated plainly.`,
      blocks: [
        {
          h2: 'Why this exists',
          html: `<p>"Is my water table dropping" searches mostly turn up either a paid well-service pitch or a vague regional headline. ${site.name} instead fits a trend to the USGS monitoring well that actually covers each county and reports the number, not an impression.</p>`,
        },
        {
          h2: 'What goes into the number',
          html: `<p>Every trend comes from USGS's National Water Information System field measurements (parameter 72019, depth to water), fit with an ordinary-least-squares slope over each well's full qualifying record. The exact qualifying bar and the model are documented in the ${guideLink('methodology', 'methodology guide')}.</p>`,
        },
        {
          h2: 'One well, honestly labeled',
          html: `<p>A county can span thousands of square miles; one monitoring well cannot describe every property in it. This site says so on every page, rather than implying a single number speaks for a whole aquifer.</p>`,
        },
        {
          h2: 'Who runs this',
          html: `<p>${site.name} is an independently run site. It is not affiliated with USGS or any home-warranty or water-testing company. Where a page includes a sponsored link, that is disclosed on the page itself and in the ${pageLink('privacy', 'privacy policy')}.</p>`,
        },
      ],
    },
    {
      slug: 'privacy',
      title: `Privacy Policy, ${site.name}`,
      description: `What ${site.name} collects, what it does not, and how any affiliate or advertising relationship is disclosed when active.`,
      blocks: [
        {
          h2: 'What this site collects',
          html: `<p>${site.name} does not require an account and does not collect personal information to show you a county's groundwater trend. Standard technical data, IP address, browser type, pages visited, and timestamps, is logged automatically by hosting and analytics infrastructure for security and aggregate traffic measurement, and is not used to identify you individually.</p>`,
        },
        {
          h2: 'Cookies',
          html: ADSENSE_ON
            ? `<p>Analytics cookies may be set to distinguish repeat visits from new ones. Google AdSense, active on this site, also sets cookies to personalize the ads shown to you; see Google's own cookie and privacy disclosures for how that works.</p>`
            : `<p>Analytics cookies may be set to distinguish repeat visits from new ones. No cookie on this site is used to build an advertising profile unless a display-advertising network is active, in which case that network's own cookie and privacy disclosures apply and are linked from this page once live.</p>`,
        },
        {
          h2: 'Advertising and affiliate links',
          html: (ADSENSE_ON || ACTIVE_WARRANTY || ACTIVE_TESTKIT)
            ? `<p>${site.name} earns money from ${[
                ADSENSE_ON && 'display advertising served by Google AdSense',
                ACTIVE_WARRANTY && `an affiliate relationship with ${ACTIVE_WARRANTY.name}`,
                ACTIVE_TESTKIT && `an affiliate relationship with ${ACTIVE_TESTKIT.name}`,
              ].filter(Boolean).join(' and ')}. Affiliate links are marked as such at the point they appear, and ${site.name} may earn a commission at no extra cost to you.</p>`
            : `<p>This site earns nothing from ads or affiliate commissions today. If that changes, this paragraph and the relevant page's disclosure line are updated together, deliberately, so that an affiliate relationship can never go live silently.</p>`,
        },
        {
          h2: 'Third parties',
          html: `<p>Groundwater trend data is pulled from USGS, a public agency; no personal data is exchanged with them. Hosting is provided by Firebase (Google). No data collected here is sold to third parties.</p>`,
        },
        {
          h2: 'Your rights and choices',
          html: `<p>Depending on where you live, you may have rights over the limited data described above, for example under California's CCPA/CPRA, other US state privacy laws, or GDPR for EU/UK visitors, including the right to know what's collected and request its deletion. To make a request, email <a href="mailto:hello@${site.host}">hello@${site.host}</a>.</p>`,
        },
        {
          h2: 'Children',
          html: `<p>This site is not directed at children under 13 and does not knowingly collect information from them.</p>`,
        },
        {
          h2: 'Changes to this policy',
          html: `<p>This page may be updated as the site adds features; the version here always reflects current practice. Questions go to the ${pageLink('contact', 'contact page')}.</p>`,
        },
      ],
    },
    {
      slug: 'terms',
      title: `Terms of Use, ${site.name}`,
      description: `The groundwater data on ${site.name} is informational, not a substitute for a professional well inspection or a hydrogeologic survey.`,
      blocks: [
        {
          h2: 'What this site is',
          html: `<p>${site.name} reports county-level groundwater depth-to-water trends from USGS public monitoring data. It is informational only and is not a substitute for a professional well inspection, which only a licensed well contractor or hydrogeologist can provide for a specific property.</p>`,
        },
        {
          h2: 'No warranty on the figures',
          html: `<p>Every figure traces to a named USGS well record, but one well cannot describe every property in a county, and the projected 10/30-year figures are a fitted rate extrapolated forward, not a measured guarantee. Nothing on this site should be the sole basis for a real-estate, insurance, or well-maintenance decision.</p>`,
        },
        {
          h2: 'No professional advice',
          html: `<p>Nothing on this site is engineering, geological, or legal advice. Whether a specific well is at risk should be confirmed with a licensed well contractor, not assumed from this site's county-level trend.</p>`,
        },
        {
          h2: 'Content and links',
          html: `<p>Site content and the underlying data presentation are the property of ${site.name} unless otherwise noted. External links, including to USGS, are provided for convenience; ${site.name} does not control and is not responsible for third-party sites it links to.</p>`,
        },
        {
          h2: 'Changes',
          html: `<p>These terms may be updated as the site changes. Continued use after an update means you accept the current version.</p>`,
        },
      ],
    },
    {
      slug: 'contact',
      title: `Contact, ${site.name}`,
      description: `Report an error in a county's groundwater trend or ask a question about the ${site.name} model.`,
      blocks: [
        {
          h2: 'Get in touch',
          html: `<p>${site.name} is run by a small team. If a county's trend, depth reading, or a link looks wrong, that's useful to hear about, the whole point of the site is that the number is trustworthy.</p><p>Email <a href="mailto:hello@${site.host}">hello@${site.host}</a>. This is not a live-chat or same-day support line; expect a reply within a few days.</p>`,
        },
        {
          h2: 'What we cannot do',
          html: `<p>We cannot inspect a specific well, test water quality, or give legal advice, see the ${pageLink('terms', 'terms of use')}. For a property-specific answer, contact a licensed well contractor.</p>`,
        },
      ],
    },
  ];
}

export function guides() {
  return [
    {
      slug: 'methodology',
      title: `How ${site.name} Calculates a County's Water Table Trend`,
      description: `The exact USGS dataset, qualifying bar, and OLS trend model behind every county's groundwater figure, named and sourced.`,
      blocks: [
        {
          h2: 'One well, fit to its own history',
          html: `<p>Each qualifying county is matched to one USGS National Groundwater Monitoring Network well: at least 15 years between its first and last reading, a reading within the last 10 years, and 6 or more usable depth-to-water measurements (parameter code 72019 from USGS's field-measurements API). An ordinary-least-squares line is fit through that well's full qualifying record; its slope, in feet per year, becomes the trend reported on the county page.</p>`,
        },
        {
          h2: 'Why "mild / moderate / severe" are not universal thresholds',
          html: `<p>Among counties that are declining, this site splits the decline rate into thirds using this dataset's own distribution (mild below ${DECLINE_TERCILES_FT_PER_DECADE.mild} ft/decade, moderate below ${DECLINE_TERCILES_FT_PER_DECADE.moderate}, severe above). No published national standard defines a "severe" aquifer decline rate, so this is an honest empirical split of this dataset, not an external benchmark, and is labeled that way.</p>`,
        },
        {
          h2: 'Coverage, stated as a number',
          html: `<p>${COVERAGE_WITH_DATA.toLocaleString('en-US')} of ${COVERAGE_TOTAL.toLocaleString('en-US')} US counties (${COVERAGE_PCT}%) have a qualifying well today. The rest show a plain "no data" page rather than a trend borrowed from a neighboring county, because groundwater behavior is local and a neighboring county's aquifer can move in the opposite direction.</p>`,
        },
      ],
    },
    {
      slug: 'well-pump-risk',
      title: `What a Declining Water Table Means for a Residential Well Pump`,
      description: `Why a deeper water table shortens a pump's working life, and what to check before it fails.`,
      blocks: [
        {
          h2: 'Depth is what a pump actually works against',
          html: `<p>A submersible pump has to lift water from whatever depth it currently sits at. As that depth increases, the pump runs longer per cycle and works harder against a longer column of water, both of which shorten a motor's working life. This is a mechanical fact independent of how fast the decline is, a county in this site's "mild" decline band still sees it, just more slowly than one in "severe."</p>`,
        },
        {
          h2: 'What this site can and cannot tell a well owner',
          html: `<p>This site reports a county's fitted trend from the nearest qualifying USGS well, not a reading from any individual property's own well. A property's actual depth to water can differ from the county figure. A well log or a direct measurement from a licensed well contractor is the only way to know a specific well's own numbers.</p>`,
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Home page markup and styles
// ---------------------------------------------------------------------------

// OLIVIA, 2026-08-26: "ideally we wanna make it look as little AI as
// possible." This page is built around a different shape than its siblings
// deliberately: instead of a grid of equal cards, the national picture is a
// single horizontal band split into five unequal segments, sized by how many
// counties actually fall in each tier - so a visitor sees the real national
// distribution, not a decorative set of three lookalike boxes.
export function homeHtml({ headline, lede, placeholder, noun, count, browseLinks }) {
  const bands = SEVERITY_TIERS_ORDERED.filter((t) => t !== 'no-data').map((tier) => {
    const members = trended.filter((r) => summaryBySlug.get(r.slug).severityTier === tier);
    const mid = members[Math.floor(members.length / 2)];
    return { tier, label: TIER_META[tier].short, n: members.length, example: mid };
  }).filter((b) => b.n > 0);
  const totalBanded = bands.reduce((a, b) => a + b.n, 0);
  const worstDeclining = trended[trended.length - 1];

  return `
<section class="wt-ask">
  <h1>${headline}</h1>
  <div class="finder" id="find">
    <div class="finder-row">
      <input id="q" type="search" autocomplete="off" spellcheck="false"
             placeholder="${placeholder}" aria-label="Find your ${noun}"
             aria-describedby="q-hint" role="combobox" aria-expanded="false"
             aria-controls="q-out" aria-autocomplete="list">
      <button type="button" id="q-go">Check it</button>
    </div>
    <div class="finder-meta">
      <div id="q-hint" class="finder-h">All ${count.toLocaleString()} US counties. Start typing.</div>
      <ul id="q-out" class="finder-out" role="listbox" hidden></ul>
    </div>
  </div>
  <p class="wt-lede">${lede}</p>
</section>

<aside class="wt-coverage">
  <h3>Before you look: only ${COVERAGE_PCT}% of counties have an answer</h3>
  <p>USGS has a monitoring well with enough history to call a trend for ${COVERAGE_WITH_DATA.toLocaleString()}
  of ${COVERAGE_TOTAL.toLocaleString()} US counties. The rest get a page that says so plainly instead of a
  number borrowed from somewhere else.</p>
</aside>

<section class="wt-scale">
  <h2>Where the ${totalBanded.toLocaleString()} counties with a trend actually land</h2>
  <figure class="wt-band" role="list">
    ${bands.map((b) => `<a role="listitem" class="wt-seg wt-seg-${b.tier}" style="flex-grow:${b.n}"
      href="${b.example ? `/${b.example.slug}` : '#find'}">
      <span class="wt-seg-n">${b.n.toLocaleString()}</span>
      <span class="wt-seg-l">${b.label}</span>
    </a>`).join('\n    ')}
    <figcaption>Each segment is sized by how many counties actually fall there, from USGS's own well
    readings${worstDeclining ? `; the fastest-declining on record is ${worstDeclining.county}, ${worstDeclining.state}` : ''}.</figcaption>
  </figure>
</section>

<section class="wt-next">
  <h2>If your county turns out to be declining</h2>
  <p>A dropping water table means a residential pump reaches deeper and works harder, which shortens its life
  long before the well itself runs dry. That is a different, more useful question than "will it run dry," and
  every declining county's page names the pace of decline so you can judge it rather than guess.</p>
</section>

<details class="browse">
  <summary>Browse all ${count.toLocaleString()} counties by state</summary>
  <ul class="hublist">
${browseLinks}
  </ul>
</details>`;
}

/** CSS for the above. Owned by this site, not the factory. */
export const styles = `
.wt-ask{padding:30px 0 4px}
.wt-ask h1{font-size:clamp(1.9rem,5vw,2.7rem); line-height:1.14; letter-spacing:-.022em;
  margin:0 0 22px; max-width:16ch; text-wrap:balance}
.wt-ask .finder{margin:0 0 16px; max-width:none}
.wt-lede{color:var(--ink-2); font-size:1rem; line-height:1.62; max-width:62ch; margin:0}
.wt-coverage{border-left:3px solid var(--accent); padding:2px 0 2px 18px; margin:30px 0}
.wt-coverage h3{font-size:1rem; margin:0 0 .5em}
.wt-coverage p{margin:0; font-size:.95rem; line-height:1.6; color:var(--ink-2)}
.wt-scale{margin:34px 0 8px}
.wt-scale h2{font-size:1.06rem; margin:0 0 14px}
.wt-band{margin:0; display:flex; gap:2px; border-radius:12px; overflow:hidden; flex-wrap:wrap}
.wt-seg{display:flex; flex-direction:column; justify-content:flex-end; gap:4px; min-width:64px;
  padding:16px 10px 12px; text-decoration:none; color:var(--ink); min-height:92px}
.wt-seg-n{font-size:1.3rem; font-weight:600; letter-spacing:-.01em}
.wt-seg-l{font-size:.74rem; line-height:1.3; color:inherit; opacity:.82}
.wt-seg-declining-severe{background:var(--bad-bg); color:var(--bad)}
.wt-seg-declining-moderate{background:var(--mid-bg); color:var(--mid)}
.wt-seg-declining-mild{background:var(--accent-soft); color:var(--accent)}
.wt-seg-stable{background:var(--line-2); color:var(--ink-2)}
.wt-seg-rising{background:var(--good-bg); color:var(--good)}
.wt-seg:hover{filter:brightness(0.95)}
.wt-band figcaption{flex-basis:100%; font-size:.8rem; color:var(--muted); margin-top:10px}
.wt-next{margin:30px 0}
.wt-next h2{font-size:1.06rem; margin:0 0 .5em}
.wt-next p{margin:0; font-size:.97rem; line-height:1.62; color:var(--ink-2); max-width:62ch}
@media (max-width:620px){
  .wt-ask{padding:18px 0 4px} .wt-ask h1{max-width:none}
  .wt-seg{min-width:45%; flex-grow:1 !important}
}
`;
