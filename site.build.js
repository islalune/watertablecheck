// Contract: see the comment block at the top of ../SiteFactory/factory/build.js.
// Exports rows, page(row), home(). Everything else, the shell, sitemap,
// legal pages and the uniqueness gate, is generic and lives in the factory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site } from '../SiteFactory/sitekit/config.js';
import {
  summarizeCounty, severity, hasQualifyingWell, SEVERITY_TIERS_ORDERED,
  DECLINE_TERCILES_FT_PER_DECADE, STABLE_BAND_FT_PER_DECADE,
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

// [R2][R3] In-state comparison for counties with their own well. A national
// rank alone tells a well owner little; how the county sits against its own
// state, and whether the nearest neighbouring well agrees, is the context
// that actually changes how to read the number.
const trendedByState = new Map();
for (const r of trended) {
  if (!trendedByState.has(r.state)) trendedByState.set(r.state, []);
  trendedByState.get(r.state).push(r);
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stateStats = new Map([...trendedByState].map(([st, list]) => [st, {
  list,
  medianTrend: median(list.map((r) => summaryBySlug.get(r.slug).trendFtPerDecade)),
  depths: list.map((r) => Number(r.current_depth_ft)).filter((d) => Number.isFinite(d) && d >= 0),
}]));
function nearestOtherQualifying(row) {
  const lat = Number(row.lat), lon = Number(row.lon);
  let best = null, bestDist = Infinity;
  for (const r of trended) {
    if (r.slug === row.slug) continue;
    const d = haversineMiles(lat, lon, Number(r.lat), Number(r.lon));
    if (d < bestDist) { bestDist = d; best = r; }
  }
  return best ? { row: best, miles: Math.round(bestDist) } : null;
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
// NWIS well ids are AGENCY-SITENO. Nearly all are USGS; a few records were
// contributed by another agency and carry its code, which a reader should not
// have to decode.
function wellRef(id, name) {
  const m = /^([A-Z]+)-(\d+)$/.exec(id || '');
  const tag = (no) => `${no}${name ? ` (${name})` : ''}`;
  if (m && m[1] !== 'USGS') return `well ${tag(m[2])}, a record another agency contributed to the USGS National Water Information System`;
  return `USGS well ${tag(m ? m[2] : id)}, part of the National Water Information System`;
}

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
      ])} <a href="/${near.row.slug}">See ${near.row.county}, ${near.row.state}'s full page</a>. See the ${guideLink('no-data-and-artesian-readings', 'no-data guide')} for why a county this close to a qualifying well still doesn't get its own number.</p>`,
    });

    blocks.push({
      h2: pick(slug + '-nodata-pop-h2', [`${county}, ${stateName} in brief`, `About ${county}`]),
      html: `<p>${pick(slug + '-nodata-pop', [
        `${county}, ${stateName} covers ${Math.round(Number(landSqMi)).toLocaleString('en-US')} square miles and is home to about ${pop(population)} people.`,
        `About ${pop(population)} people live across ${county}'s ${Math.round(Number(landSqMi)).toLocaleString('en-US')} square miles, in ${stateName}.`,
      ])} USGS's National Groundwater Monitoring Network covers ${COVERAGE_WITH_DATA.toLocaleString('en-US')} of ${COVERAGE_TOTAL.toLocaleString('en-US')} US counties (${COVERAGE_PCT}%) today; ${county} isn't one of them yet, see the ${guideLink('methodology', 'methodology guide')} for the exact qualifying bar.</p>`,
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
      ])} See the ${guideLink('no-data-and-artesian-readings', 'no-data guide')} for what "no data" does and doesn't mean here.</p>
<p>${pick(slug + '-nodata-pop2', [
        `${county}, ${stateName} covers ${Math.round(Number(landSqMi)).toLocaleString('en-US')} square miles and is home to about ${pop(population)} people.`,
        `About ${pop(population)} people live across ${county}'s ${Math.round(Number(landSqMi)).toLocaleString('en-US')} square miles, in ${stateName}.`,
      ])} The exact qualifying bar every county is measured against is in the ${guideLink('methodology', 'methodology guide')}.</p>`,
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
    // [R20][R21][R5] First screen, in reading order: the visitor's own
    // question (the h1), one giant local number with its where/when note set
    // beside it, one line on what the number means, one line on what to do.
    // Sits on the same ground cross-section as the homepage, text in the sky.
    const rate = Math.abs(s.trendFtPerDecade);
    const falling = s.trendFtPerDecade > 0;
    const flat = rate < 0.5;
    const feet = ft(rate) === '1' ? 'foot' : 'feet';
    const heroYear = Number(s.lastDate?.slice(0, 4));
    const means = flat
      ? `The water here has barely moved in ${Math.round(s.spanYears)} years.`
      : falling
        ? `Every ten years a well here needs about ${ft(rate)} more ${feet} of reach.`
        : `The water here has been coming back up, about ${ft(rate)} ${feet} every ten years.`;
    const stale = heroYear && heroYear < 2021
      ? `<p class="wt-stale">This well was last read in ${heroYear}. The trend covers the years it was measured, not since.</p>`
      : '';
    blocks.push({
      html: `<div class="wt-hero">${STRATA}
<div class="wt-hero-num"><span class="wt-big">${ft(rate)}</span>
<p class="wt-note">${feet} per decade ${flat ? 'of change' : falling ? 'deeper' : 'shallower'} since ${s.firstDate?.slice(0, 4)}.<br>Last read ${s.lastDate}, USGS well ${s.wellId}.</p></div>
<p class="wt-means">${means}</p>
${stale}<p class="wt-do">Find your own well's drilled depth on your state's free well-record search and compare it with this.</p>
</div>`,
    });
    blocks.push({
      h2: headlineH2 === `Is the water table dropping in ${county}, ${state}?` ? `What ${county}'s well shows` : headlineH2,
      html: `<p>${trendLine} ${caveat}</p>`,
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
        `${wellRef(s.wellId, s.wellName ? titleCase(s.wellName) : '')}. ` +
        `The qualifying bar and the OLS fit behind this trend are documented in the ${guideLink('methodology', 'methodology guide')}.</p>`,
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
      html: `<p>${rankLine} ${popLine} See the ${guideLink('fastest-moving-counties', 'fastest-moving counties guide')} for how ${county} stacks up against the most extreme cases nationally.</p>`,
    });

    // --- against the rest of the state, and the nearest neighbour ----------------
    const stats = stateStats.get(state);
    const t = s.trendFtPerDecade;
    const moveWord = (v) => (v > 0 ? 'of decline' : 'of rise');
    const stateParas = [];
    if (stats.list.length === 1) {
      stateParas.push(`${county} is the only county in ${stateName} with a well that clears the qualifying bar, so there is no in-state comparison to make yet.`);
    } else {
      const n = stats.list.length;
      const declineRank = n - stats.list.findIndex((r) => r.slug === slug);
      const diff = t - stats.medianTrend;
      const medTxt = `${ft(Math.abs(stats.medianTrend))} ft per decade ${moveWord(stats.medianTrend)}`;
      let cmp;
      if (Math.abs(diff) < 0.3) cmp = `That is close to the middle of the state: the median ${stateName} county shows ${medTxt}.`;
      else if (diff > 0) cmp = `The water here is dropping ${ft(diff)} ft per decade faster than in the median ${stateName} county, which shows ${medTxt}.`;
      else cmp = `That is ${ft(-diff)} ft per decade better than the median ${stateName} county, which shows ${medTxt}.`;
      const rankTxt = declineRank === 1 && t > 0
        ? `${county} has the fastest-falling water table of the ${n} ${stateName} counties with a qualifying well.`
        : declineRank === n
          ? `Of the ${n} ${stateName} counties with a qualifying well, ${county} has the slowest decline or the strongest rise.`
          : `Ranked by how fast the water is falling, ${county} comes ${ordinal(declineRank)} of the ${n} ${stateName} counties with a qualifying well.`;
      stateParas.push(`${rankTxt} ${cmp}`);
      const d = Number(row.current_depth_ft);
      if (!s.isArtesian && Number.isFinite(d) && stats.depths.length >= 3) {
        const shallower = stats.depths.filter((x) => x < d).length;
        const share = shallower / stats.depths.length;
        stateParas.push(share >= 0.75
          ? `At ${ft(d)} ft down, this well's water sits deeper than in ${shallower} of the ${stats.depths.length} ${stateName} wells used on this site. A deep table leaves less room before a shallow residential well loses its water, even at a modest rate of decline.`
          : share <= 0.25
            ? `Water in this well is only ${ft(d)} ft down, shallower than all but ${shallower} of the ${stats.depths.length} ${stateName} wells used here. A shallow table is easier to reach, and also quicker to feel a dry summer.`
            : `The ${ft(d)} ft depth to water is unremarkable for ${stateName}: ${shallower} of the ${stats.depths.length} wells used here read shallower.`);
      }
    }
    const nb = nearestOtherQualifying(row);
    if (nb) {
      const ns = summaryBySlug.get(nb.row.slug);
      const where = nb.row.state === state ? nb.row.county : `${nb.row.county}, ${nb.row.state}`;
      const sameWay = (ns.severityTier.startsWith('declining') && s.severityTier.startsWith('declining')) || ns.severityTier === s.severityTier;
      stateParas.push(`The nearest other county with its own qualifying well is ${where}, ${nb.miles} miles away. ` + (sameWay
        ? `Its well points the same way (${ft(Math.abs(ns.trendFtPerDecade))} ft per decade ${moveWord(ns.trendFtPerDecade)}), which makes ${county}'s reading look regional rather than a quirk of one well.`
        : `Its well is ${TIER_META[ns.severityTier].word} instead, at ${ft(Math.abs(ns.trendFtPerDecade))} ft per decade. Neighbouring wells that disagree can be tapping different aquifers or sitting near different amounts of pumping, so ${county}'s own well is the better guide here.`));
    }
    const lastYear = Number(s.lastDate?.slice(0, 4));
    if (lastYear && lastYear < 2021) {
      stateParas.push(`One caution: this well's last reading is from ${lastYear}. The trend describes the years it was measured and says nothing about what the water has done since.`);
    }
    blocks.push({
      h2: `${county} against the rest of ${stateName}`,
      html: stateParas.map((p) => `<p>${p}</p>`).join('\n'),
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
    h1: s.hasQualifyingWell ? `Is the water table dropping in ${county}, ${state}?` : undefined,
    description: s.hasQualifyingWell
      ? `${county}, ${state}: depth to water is ${s.severityLabel.toLowerCase()}, ${ft(Math.abs(s.trendFtPerDecade))} ft/decade, from USGS's own long-term monitoring well.`
      : `${county}, ${state} has no USGS long-term monitoring well with enough history for a water-table trend yet.`,
    blocks,
    // [R2][R10] A county with no qualifying well of its own can only borrow a
    // neighbour's number, so its page is mostly the same few sentences with
    // the name swapped. It stays up for the visitor who searches for it, but
    // carries no ads, sits outside the sitemap and hubs, and is not indexed.
    noindex: !s.hasQualifyingWell,
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
          html: `<p>${site.name} turns public USGS monitoring-well data into a straight answer for anyone wondering about their own well. It is not affiliated with USGS or any home-warranty or water-testing company. Where a page includes a sponsored link, that is disclosed on the page itself and in the ${pageLink('privacy', 'privacy policy')}.</p>`,
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
              ].filter(Boolean).join(' and ')}.${(ACTIVE_WARRANTY || ACTIVE_TESTKIT)
                ? ` Affiliate links are marked as such at the point they appear, and ${site.name} may earn a commission at no extra cost to you.`
                : ''}${ADSENSE_ON
                ? ` AdSense may use cookies to personalize the ads shown to you; see Google's own advertising and privacy policies for how that works.`
                : ''}</p>`
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
      title: `How ${site.name} Works Out Whether a County's Water Table Is Dropping`,
      description: `Where every county's groundwater number comes from, which wells count, how the trend is drawn, and what the number cannot tell you about your own well.`,
      // [R3][R10][R29] Written for someone who has never heard the words
      // "water table". Every figure below is read from the same rows the
      // county pages use, so the guide cannot drift from the data.
      blocks: (() => {
        const withWell = rows.filter((r) => hasQualifyingWell(r));
        const nums = (k) => withWell.map((r) => Number(r[k])).filter(Number.isFinite);
        const spans = nums('span_years');
        const counts = nums('n_measurements');
        const depths = nums('current_depth_ft').filter((d) => d >= 0);
        const lastYears = withWell.map((r) => Number(String(r.last_date).slice(0, 4))).filter(Number.isFinite);
        const firstYears = withWell.map((r) => Number(String(r.first_date).slice(0, 4))).filter(Number.isFinite);
        const recent = lastYears.filter((y) => y >= 2024).length;
        const oldest = Math.min(...firstYears);
        const pre1950 = firstYears.filter((y) => y < 1950).length;
        const thin = counts.filter((n) => n < 12).length;
        const dir = { declining: 0, stable: 0, rising: 0 };
        for (const r of withWell) if (r.direction in dir) dir[r.direction] += 1;
        const fmt = (n) => Math.round(n).toLocaleString('en-US');
        const link = (r) => pageLink(r.slug, `${r.county}, ${r.state}`);
        const la = rows.find((r) => r.slug === 'los-angeles-county-ca' && hasQualifyingWell(r));
        const severe = trended.find((r) => summaryBySlug.get(r.slug).severityTier === 'declining-severe');
        const rising = trended.find((r) => summaryBySlug.get(r.slug).severityTier === 'rising');
        const noData = rows.find((r) => !summaryBySlug.get(r.slug).hasQualifyingWell);
        return [
          {
            h2: 'What the number on a county page actually measures',
            html: `<p>${site.name} is a free site built entirely on public government records. It gives each US county that has a long-running government monitoring well one number: how fast the water underground is getting deeper or shallower. If your home runs on a private well, that tells you whether your well may one day need to reach further down for water. This page explains where the number comes from and how far to trust it. To see yours, ${pageLink('', 'search for your county on the home page')}.</p><p>Under most of the country, the ground is soaked with water some distance down. The top of that soaked layer is the water table. A household well works by reaching below it, so the question that matters to a well owner is how far down it sits and whether that distance is growing.</p><p>The figure this site reports is depth to water: the distance in feet from the ground surface down to the water standing in a well. It is measured by the U.S. Geological Survey (USGS, the federal science agency that tracks the country's water), mostly by someone lowering a marked steel tape, or a cable with a sensor that beeps when it touches water, into a monitoring well. A monitoring well is not anyone's drinking well. It exists only so the water level can be read again and again over the years.</p>`,
          },
          {
            h2: 'Which wells are allowed to speak for a county',
            html: `<p>USGS publishes readings from a great many wells, but plenty were measured only a few times, or not for decades. A county only gets a trend here if one of its wells clears all three of these:</p><ul><li>at least 15 years between its first and latest reading,</li><li>a reading taken within the last 10 years,</li><li>at least 6 usable depth readings.</li></ul><p>Only ${COVERAGE_WITH_DATA.toLocaleString('en-US')} of ${COVERAGE_TOTAL.toLocaleString('en-US')} US counties (${COVERAGE_PCT}%) have a well like that. Where a county has several, the site uses one: the well with the longest record, and if two tie, the one read most recently. One well cannot describe every property in a big county. It shows which way the water under that area has been heading, which is a starting point for your own well, not a verdict on it (more on that further down). The site does not average several wells together, because wells in one county often tap different layers of rock whose water moves in different directions, and an average of those would describe none of them. Each county page prints its well's USGS identification code (a string like USGS-343237117582601), which you can type into the USGS website to see every reading yourself.</p><p>Most of the chosen wells clear the bar easily. The median chosen well has ${fmt(median(counts))} readings over ${fmt(median(spans))} years, and ${pre1950.toLocaleString('en-US')} of them were first read before 1950 (the oldest record starts in ${oldest}). ${thin} wells sit near the minimum with fewer than 12 readings, and their trends deserve less weight; the county page shows the reading count so you can see that for yourself.</p>`,
          },
          {
            h2: 'How the trend is drawn',
            html: `<p>Picture every reading from the well plotted on a chart, year along the bottom and depth up the side. The site draws the single straight line that sits closest to all of those points at once. How steeply that line tilts is the trend, reported in feet per decade because a yearly figure is often too small to picture.</p><p>Because the site measures how far down the water is, a bigger number over time is bad news: a trend of 5 feet per decade means the water is 5 feet further down every ten years, so the water table is dropping. A trend with a minus sign means the water is coming closer to the surface. Anything within ${STABLE_BAND_FT_PER_DECADE} feet per decade either way is called stable, because a change that small is hard to tell apart from ordinary measuring noise.</p><p>The line uses the whole record, not the last few readings. That is deliberate. Water levels normally fall in a dry summer and climb back in a wet spring, so a straight line through 15 or more years shows the long direction and ignores one bad season. The cost is that a sudden recent drop shows up more slowly here than it does in the raw readings.</p>`,
          },
          {
            h2: 'What the result looks like across the country',
            html: `<p>Of the ${COVERAGE_WITH_DATA.toLocaleString('en-US')} counties with a qualifying well, ${dir.declining.toLocaleString('en-US')} are dropping, ${dir.stable.toLocaleString('en-US')} are stable and ${dir.rising.toLocaleString('en-US')} are rising. In a typical well the water sits ${ft(median(depths))} feet below ground at its latest reading, though that hides a huge range: some wells are a few feet deep and some read several hundred.</p><p>To help you compare, the dropping counties are lined up from slowest to fastest and cut into three equal groups, labelled mild, moderate and severe. In feet per decade, mild is anything under ${DECLINE_TERCILES_FT_PER_DECADE.mild}, moderate is under ${DECLINE_TERCILES_FT_PER_DECADE.moderate}, and severe is faster than that. These labels only say how a county compares with the others. No government agency defines a severe decline, so they are not an official danger rating.</p><p>${severe ? `${link(severe)} is one of the severe ones, a well with decades of steady readings and a line that keeps tilting deeper.` : ''} ${rising ? `${link(rising)} runs the other way, a county whose water has come closer to the surface.` : ''} ${noData ? `${link(noData)} has no qualifying well at all, and its page says so instead of borrowing a neighbor's number.` : ''}</p>`,
          },
          {
            h2: 'How fresh the readings are',
            html: `<p>${recent.toLocaleString('en-US')} of the chosen wells have been read at least once since the start of 2024. The rest are older, and the 10-year rule means some are getting close to the edge. ${la ? `${link(la)} is one example: its well has ${Number(la.n_measurements).toLocaleString('en-US')} readings going back to ${String(la.first_date).slice(0, 4)}, but the latest was taken in ${String(la.last_date).slice(0, 4)}.` : ''} When a county's newest reading is more than about five years old, its page says so on the first screen, because a lot can change in a drought.</p>`,
          },
          {
            h2: 'What this cannot tell you about your own well',
            html: `<p>One monitoring well stands in for a whole county, and counties can be big. Your well may draw from a different layer of rock than the monitoring well, sit closer to a town's pumping wells or a big irrigation field, or be drilled much deeper. Any of those can make your water level behave differently from the county number.</p><p>So treat the county trend as the starting point. The answer for your property comes from your own well record (the driller's log, the report the company that drilled it filed with the state; most states let you search these free online, usually on the website of the state's water, geology or natural resources department, under a name like "well log search"), compared against the county's depth to water and how fast it is falling. If you have no record, a licensed well driller can measure the water level in your well directly. The ${guideLink('well-pump-risk', 'well-pump guide')} explains what a falling table does to a pump, and the ${guideLink('no-data-and-artesian-readings', 'no-data guide')} covers counties with no qualifying well. It also explains artesian wells. In those, the underground water is under so much pressure that it pushes up the pipe above ground level by itself.</p>`,
          },
          {
            h2: 'Where the data comes from',
            html: `<p>All readings come from the USGS National Water Information System and the National Ground-Water Monitoring Network, both free and public. The site does not use any paid data. Each county page lists its well id, the dates of the first and latest readings, and how many readings the trend is built on, so every number can be traced back to the government record it came from.</p>`,
          },
        ];
      })(),
    },
    {
      slug: 'well-pump-risk',
      title: `What a Dropping Water Table Does to a Home Well Pump`,
      description: `How a falling water table reaches a household well pump, how to work out from your own well record how much room your pump has left, and which counties are dropping fast enough for it to matter soon.`,
      // [R3][R10][R29] Rewritten for someone who owns a well but has never
      // thought about how the pump works. Every figure is read from the same
      // county rows the county pages use, so the guide cannot drift from them.
      blocks: (() => {
        const dec = rows
          .filter((r) => summaryBySlug.get(r.slug).pumpRiskRelevant)
          .map((r) => ({ r, s: summaryBySlug.get(r.slug) }));
        const trends = dec.map((x) => x.s.trendFtPerDecade);
        const depths = dec.map((x) => x.s.currentDepthFt).filter((d) => d !== null && d >= 0);
        const p30 = dec.map((x) => x.s.decline30yrFt).filter((d) => d !== null);
        const fast10 = trends.filter((t) => t >= 10).length;
        const shallow25 = depths.filter((d) => d < 25).length;
        const deep100 = depths.filter((d) => d > 100).length;
        const shallowSevere = dec.filter((x) => x.s.currentDepthFt !== null && x.s.currentDepthFt >= 0
          && x.s.currentDepthFt < 50 && x.s.trendFtPerDecade >= DECLINE_TERCILES_FT_PER_DECADE.moderate);
        const stale = dec.filter((x) => Number(String(x.s.lastDate).slice(0, 4)) < 2021).length;
        const pop = dec.reduce((a, x) => a + (x.s.population || 0), 0);
        const byState = {};
        for (const x of dec) byState[x.s.stateName] = (byState[x.s.stateName] || 0) + 1;
        const topStates = Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const fastest = [...dec].sort((a, b) => b.s.trendFtPerDecade - a.s.trendFtPerDecade).slice(0, 3);
        const fmt = (n) => Math.round(n).toLocaleString('en-US');
        const link = ({ r, s }) => pageLink(r.slug, `${s.county}, ${s.state}`);
        const medTrend = median(trends);
        const ex = shallowSevere.sort((a, b) => b.s.nMeasurements - a.s.nMeasurements)[0];
        const exYears = ex ? Math.floor(ex.s.currentDepthFt / ex.s.trendFtPerDecade * 10) : null;
        return [
          {
            h2: 'How the pump and the water table meet',
            html: `<p>${site.name} is a free site that reads the U.S. Geological Survey's long-running monitoring wells (the federal agency's wells that exist only to track underground water) and shows, county by county, whether the water is getting deeper. ${pageLink('', 'Search for your county on the home page')} first: if its water is not dropping, most of this page does not apply to you. If it is, here is what that means for your pump.</p><p>Signs at the tap that a pump is struggling: sputtering or air in the lines, pressure that fades during a long shower or while watering, and a pump you can hear running longer than it used to. A falling water table is one cause. Age and wear are far more common ones, which is why the county trend is worth checking before you blame either.</p><p>Most homes on a private well have a submersible pump: a long, narrow motor and pump hung on a pipe deep inside the well, under the water. When you open a tap, it pushes water up the pipe to a pressure tank in the house. Older or very shallow wells sometimes use a jet pump instead, which sits above ground in a basement or well house and pulls water up by suction. If you can see a pump motor in your basement, crawl space or well house, you most likely have a jet pump. If all you see is a capped pipe coming out of the ground, the pump is down in the well.</p><p>Either way, the pump works from wherever the water currently stands. The water table is the top of the water-soaked ground, and in a well it shows up as the level the water settles at when nobody is pumping. If that level gets lower over the years, three things follow in order.</p><p>First, the pump has to lift the water further, so the same pump delivers a little less water per minute and runs a little longer to fill the tank. Second, the cushion of water sitting above the pump gets thinner. A submersible motor is cooled by water flowing past it, and it needs that cushion to stay covered while it runs, because the level inside a well dips while it is pumping. Third, if the level drops far enough that the pump starts pulling air, it can overheat and fail, and the house loses water until a well contractor comes out.</p><p>A jet pump hits its limit sooner. Suction can only raise water about 25 feet in practice, so once the water in a shallow well falls past that, a jet pump cannot reach it at all.</p>`,
          },
          {
            h2: 'What the county numbers say about the size of the problem',
            html: `<p>${fmt(dec.length)} counties on this site have a USGS monitoring well whose water is getting deeper. About ${(pop / 1e6).toFixed(0)} million people live in them. The most are in ${topStates.slice(0, -1).map(([n, c]) => `${n} (${c})`).join(', ')} and ${topStates.at(-1)[0]} (${topStates.at(-1)[1]}).</p><p>For most of them the change is slow. In the typical dropping county the water is going down ${ft(medTrend)} feet every ten years, and if that pace held for 30 years it would add up to about ${ft(median(p30))} feet. A pump hung with a normal margin below the water usually has room for that. But ${fmt(fast10)} counties are dropping 10 feet or more per decade, and at that pace 30 years means 30 feet or more. That is enough to matter for a pump that was set close to the water when the well was drilled.</p><p>How deep the water already sits changes the picture too. In ${fmt(shallow25)} of the dropping counties the monitoring well reads less than 25 feet to water, shallow enough that some homes there still run a jet pump. In ${fmt(deep100)} it reads more than 100 feet, where every extra foot of lift is added on top of an already long climb.</p>`,
          },
          {
            h2: 'Working out how much room your own pump has',
            html: `<p>Your county's page on this site (${pageLink('', 'find it from the home page')}) gives you how fast the water is dropping. Your own well record tells you how much room your pump has. You need three numbers, and all of them are usually on the driller's log, the form the company that drilled your well filed with the state:</p><ul><li>the water level when the well was drilled, often printed as "static water level" (how far down the water stood when no one was pumping),</li><li>the pump depth, often printed as "pump setting" (how far down the pump was hung),</li><li>the year the well was drilled.</li></ul><p>Most states let you look up driller's logs free online, usually on the website of the state's water, geology or natural resources department under a name like "well log search". If the pump was replaced since, the receipt or the contractor who did it will have the new setting depth.</p><p>One warning before the arithmetic: the county's monitoring well may draw from a different layer of rock than yours, so this gives a rough idea, not your exact number. Work it out in three steps:</p><ol><li>Pump depth minus the water level at drilling. That is the cushion of water the pump started with.</li><li>The county's drop per decade times the decades since drilling. That is roughly how much of the cushion is gone.</li><li>Step 1 minus step 2 is your cushion today. Divide it by the county's drop per decade to see how many decades are left before the water reaches the pump, if the trend holds.</li></ol><p>A worked example: a well drilled 20 years ago with the water at 60 feet and the pump at 120 feet started with 60 feet of cushion. In a county dropping 2 feet per decade it has lost about 4 feet, and still has decades of room. In a county dropping 15 feet per decade it has lost about 30 feet, and half its cushion is gone.</p><p>Treat the answer as a reason to look, not a forecast. Your water level also dips each time the pump runs, more so in a dry summer. Only a measurement in your own well says where your water actually is.</p>`,
          },
          {
            h2: 'Where shallow water and a fast drop come together',
            html: `<p>The tightest situation is water that starts close to the surface and is falling fast, because those wells were often drilled shallow with the pump set near the water. ${fmt(shallowSevere.length)} counties combine a monitoring-well reading under 50 feet with a drop of ${DECLINE_TERCILES_FT_PER_DECADE.moderate} feet or more per decade, the fastest third of dropping counties on this site.${ex ? ` ${link(ex)} is one of them: its monitoring well has ${fmt(ex.s.nMeasurements)} readings over ${Math.round(ex.s.spanYears)} years, the water sits ${ft(ex.s.currentDepthFt)} feet down, and it is going down ${ft(ex.s.trendFtPerDecade)} feet per decade. At that pace the water there would be twice as deep in about ${exYears} years.` : ''}</p><p>When you read your own county's page, look at how deep its monitoring well's water is before comparing it with yours. The fastest drops on the site, in ${fastest.slice(0, -1).map(link).join(', ')} and ${link(fastest.at(-1))}, come from monitoring wells hundreds of feet deep, reading a layer of rock that many large wells draw from at once, so a shallow household well nearby may not be falling as fast.</p><p>One more thing to check on any county page is the date of the latest reading. ${fmt(stale)} of the dropping counties have a monitoring well last read before 2021, and the trend says nothing about what has happened since.</p>`,
          },
          {
            h2: 'What a well owner can actually do',
            html: `<p>If your numbers say the cushion is getting thin, the usual fixes come from a licensed well contractor. They can measure the water level in your well directly, which settles the question. If there is still depth in the well below the pump, they can lower the pump further down. If the well itself is too shallow, the options are deepening it or drilling a new one, which costs far more, so it pays to find out early.</p><p>Signs at the tap that the pump is struggling include sputtering or air in the lines, pressure that drops off during long showers or watering, and a pump that runs longer than it used to. If you notice any of those and your county is marked as dropping, call before the pump fails.</p><p>The ${guideLink('methodology', 'methodology guide')} explains how each county's trend is worked out, and the ${guideLink('no-data-and-artesian-readings', 'no-data guide')} covers counties with no monitoring well at all.</p>`,
          },
        ];
      })(),
    },
    {
      slug: 'fastest-moving-counties',
      title: `The US Counties Where the Water Table Is Moving Fastest`,
      description: `Which counties have underground water dropping or rising fastest, how much to trust each of those numbers, and why the fastest ones are often not the ones a household well owner should worry about most.`,
      // [R3][R10][R28][R29] Rewritten for someone who has never heard of a
      // monitoring well. Every figure is read from the same county rows the
      // county pages use, so the guide cannot drift from the data.
      blocks: (() => {
        const all = trended.map((r) => ({ r, s: summaryBySlug.get(r.slug) }));
        const down = all.filter((x) => x.s.severityTier.startsWith('declining'))
          .sort((a, b) => b.s.trendFtPerDecade - a.s.trendFtPerDecade);
        const up = all.filter((x) => x.s.severityTier === 'rising')
          .sort((a, b) => a.s.trendFtPerDecade - b.s.trendFtPerDecade);
        const fmt = (n) => Math.round(n).toLocaleString('en-US');
        const yr = (d) => String(d).slice(0, 4);
        const link = ({ r, s }) => pageLink(r.slug, `${s.county}, ${s.state}`);
        const line = (x) => `<li>${link(x)}: ${ft(Math.abs(x.s.trendFtPerDecade))} feet per decade ${x.s.trendFtPerDecade > 0 ? 'deeper' : 'shallower'}, from ${fmt(x.s.nMeasurements)} readings between ${yr(x.s.firstDate)} and ${yr(x.s.lastDate)}, water now ${ft(x.s.currentDepthFt)} feet down${x.s.trendFtPerDecade > 0 && x.s.currentDepthFt < x.s.trendFtPerDecade * x.s.spanYears / 10 ? `. This is an artesian well: its water once pushed up the pipe above ground level by itself, and the drop is that push weakening (the ${guideLink('no-data-and-artesian-readings', 'guide to artesian wells')} explains)` : ''}</li>`;
        const andList = (xs) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
        const topDown = down.slice(0, 10);
        const topUp = up.slice(0, 6);
        const fast20 = down.filter((x) => x.s.trendFtPerDecade >= 20).length;
        const rise10 = up.filter((x) => x.s.trendFtPerDecade <= -10).length;
        const thinTop = topDown.filter((x) => x.s.nMeasurements < 12);
        const staleTop = topDown.filter((x) => Number(yr(x.s.lastDate)) < 2021);
        const deepTop = topDown.filter((x) => x.s.currentDepthFt !== null && x.s.currentDepthFt > 150).length;
        const solid = down.filter((x) => x.s.nMeasurements >= 50 && Number(yr(x.s.lastDate)) >= 2024);
        const solidTop = solid.slice(0, 3);
        const first = topDown[0];
        const big = [...topDown].sort((a, b) => (b.s.population || 0) - (a.s.population || 0))[0];
        return [
          {
            h2: 'What "moving fast" means here',
            html: `<p>${site.name} is a free site that reads the U.S. Geological Survey's monitoring wells. The USGS is the federal science agency that tracks the country's water, and a monitoring well is a well nobody drinks from; it exists only so someone can measure, year after year, how far down the water stands. For each county with a long enough record, the site picks one monitoring well to stand for the whole county (the one with the longest record) and draws a straight line through all of its readings and reports how steeply it tilts, in feet per decade. ${pageLink('', 'Search for your county on the home page')} to see yours.</p><p>A county whose water is "dropping" is one where the water sits further below the ground each decade, so a household well there has to reach a little deeper to find it. "Rising" means the water is coming closer to the surface. This page lists the counties at both ends: where the water has moved furthest per decade, in either direction, out of the ${fmt(all.length)} counties with a qualifying well.</p><p>A fast number is not automatically the scariest number for a home well, and the sections below explain why. Read the list as the places worth a closer look, then check the reading count and date beside each one before you trust it.</p>`,
          },
          {
            h2: `The ${topDown.length} counties where the water is dropping fastest`,
            html: `<p>Of ${fmt(down.length)} dropping counties, ${fmt(fast20)} are losing 20 feet or more per decade. These are the ten fastest:</p><ul>${topDown.map(line).join('')}</ul><p>For scale, the typical dropping county on this site goes down ${ft(median(down.map((x) => x.s.trendFtPerDecade)))} feet per decade. Every county on this list is moving many times faster than that.</p>`,
          },
          {
            h2: 'How much to trust the top of the list',
            html: `<p>A straight line through a handful of readings can tilt steeply for reasons that have nothing to do with a long decline: one reading taken while a nearby well was pumping hard, or a well that was repaired or deepened partway through its record. The fewer readings a line rests on, the more one odd reading moves it.</p><p>${thinTop.length ? `${andList(thinTop.map(link))} ${thinTop.length === 1 ? 'is' : 'are'} on the list with fewer than 12 readings. ${first && thinTop.includes(first) ? `${link(first)} tops the whole list on only ${fmt(first.s.nMeasurements)}, so treat its number as a reason to look at the raw readings on the USGS site, not as a settled fact. ` : ''}` : ''}${staleTop.length ? `${staleTop.length === 1 ? 'One county' : `${staleTop.length} counties`} on the list (${andList(staleTop.map(link))}) had ${staleTop.length === 1 ? 'its' : 'their'} last reading before 2021, so the line says nothing about recent wet or dry years.` : ''}</p><p>The steadiest evidence comes from wells read many times and recently. ${solidTop.length ? `Among dropping counties with 50 or more readings and a reading since 2024, the fastest are ${andList(solidTop.map((x) => `${link(x)} (${ft(x.s.trendFtPerDecade)} feet per decade over ${fmt(x.s.nMeasurements)} readings)`))}. Those are the declines on this page that are hardest to explain away.` : ''}</p>`,
          },
          {
            h2: 'Why the fastest drops are often in deep wells',
            html: `<p>In ${fmt(deepTop)} of the ten fastest-dropping counties, the monitoring well's water is more than 150 feet down. Deep wells like these usually tap a deep layer of water-bearing rock, called an aquifer, that towns, farms and factories pump from at the same time. When many big wells draw on one layer, its level can fall by feet every year.</p><p>A household well a few miles away may draw from a shallower layer that refills from rain and snowmelt and barely moves. So a fast county number tells you the deep water there is being pumped out faster than rain and snow can refill it. Whether your own well is affected depends on how deep your well goes and which layer it draws from, both of which are on your driller's log (the report the company that drilled your well filed with the state; most states let you search these free on their water or natural resources department's website).</p><p>${big ? `${link(big)} is the most populated county on the list, with about ${(big.s.population / 1e6).toFixed(1)} million residents, so its line is the one the most people live above. ` : ''}Our ${guideLink('well-pump-risk', 'guide to well pumps')} walks through comparing your own well's numbers with your county's trend.</p>`,
          },
          {
            h2: `The ${topUp.length} counties where the water is rising fastest`,
            html: `<p>${fmt(up.length)} counties have water coming closer to the surface, ${fmt(rise10)} of them by 10 feet or more per decade. The fastest:</p><ul>${topUp.map(line).join('')}</ul><p>A rise usually means the water is being refilled faster than it is pumped out: a town switched from wells to river water, a factory closed, irrigation cut back, or a run of wet years. It is mostly good news for a well owner. It is not always good news for a basement or a septic field, which can have trouble when water sits close to the surface. This site does not measure flooding or soggy ground, only how far down the water stands.</p>`,
          },
          {
            h2: 'Checking any county on this list yourself',
            html: `<p>Every county page prints its monitoring well's USGS identification number. Type it into the USGS National Water Information System website and you can see each reading the line was drawn through, with its date. If the readings bunch up in a few years, or one reading sits far from the rest, you will see it straight away.</p><p>The list on this page is rebuilt from the data every time the site is updated, so a new reading that changes a well's line changes its place here too. How the line is drawn and which wells qualify is in the ${guideLink('methodology', 'methodology guide')}, and counties with no qualifying well are covered in the ${guideLink('no-data-and-artesian-readings', 'no-data guide')}.</p>`,
          },
        ];
      })(),
    },
    {
      slug: 'no-data-and-artesian-readings',
      title: `Why Some Counties Have No Groundwater Trend, and Why Some Wells Read Below Zero`,
      description: `Why ${site.name} has no water-table number for more than half of US counties, what those county pages show instead, how far to trust a neighbor's well, and why a few wells report water standing above the ground.`,
      // [R3][R10][R28][R29] Rewritten for someone who landed on a county page
      // with no number and wants to know why. Every figure is computed from
      // the same county rows the pages use, so the guide cannot drift.
      blocks: (() => {
        const NEARBY = 150;
        const fmt = (n) => Math.round(n).toLocaleString('en-US');
        const link = (r) => pageLink(r.slug, `${r.county}, ${r.state_name}`);
        const none = rows.filter((r) => !hasQualifyingWell(r));
        const near = none.map((r) => ({ r, n: nearestBySlug.get(r.slug) })).filter((x) => x.n);
        const miles = near.map((x) => x.n.miles);
        const within30 = miles.filter((m) => m <= 30).length;
        const within60 = miles.filter((m) => m <= 60).length;
        const tooFar = near.filter((x) => x.n.miles > NEARBY);
        const crossState = near.filter((x) => x.n.row.state !== x.r.state).length;
        const popAll = rows.reduce((a, r) => a + (Number(r.population) || 0), 0);
        const popNone = none.reduce((a, r) => a + (Number(r.population) || 0), 0);
        const bigNone = [...none].sort((a, b) => Number(b.population) - Number(a.population)).slice(0, 4);
        const byState = new Map();
        for (const r of rows) {
          const v = byState.get(r.state_name) || { t: 0, q: 0 };
          v.t += 1; if (hasQualifyingWell(r)) v.q += 1;
          byState.set(r.state_name, v);
        }
        const states = [...byState].filter(([, v]) => v.t >= 20);
        const low = [...states].sort((a, b) => a[1].q / a[1].t - b[1].q / b[1].t).slice(0, 3);
        const high = [...states].sort((a, b) => b[1].q / b[1].t - a[1].q / a[1].t).slice(0, 3);
        const covLine = ([n, v]) => `${n} (${v.q} of ${v.t})`;
        const artesian = rows.filter((r) => summaryBySlug.get(r.slug).isArtesian)
          .map((r) => ({ r, s: summaryBySlug.get(r.slug) }));
        const highest = [...artesian].sort((a, b) => a.s.currentDepthFt - b.s.currentDepthFt)[0];
        const losing = artesian.filter((x) => x.s.trendFtPerDecade > STABLE_BAND_FT_PER_DECADE);
        const gaining = artesian.filter((x) => x.s.trendFtPerDecade < -STABLE_BAND_FT_PER_DECADE);
        const fastLoss = [...losing].sort((a, b) => b.s.trendFtPerDecade - a.s.trendFtPerDecade)[0];
        const aLink = (x) => pageLink(x.r.slug, `${x.s.county}, ${x.r.state_name}`);
        return [
          {
            h2: 'Why your county has no groundwater trend of its own',
            html: `<p>You are on ${site.name}, a free site that shows, county by county, whether the water underground is getting deeper. The water table is the top of the water-soaked ground, and a household well only works if it reaches below it. Each number on the site comes from a monitoring well run by the U.S. Geological Survey (USGS, the federal science agency that tracks the country's water). Those wells exist only so someone can come back and measure the water level, year after year. This matters most if your home gets its water from its own private well. If you pay a city or water district for your water, the trend tells you about the ground under your area, not about your tap.</p><p>A county gets its own number only if one of its monitoring wells has a long, recent record: at least 15 years between the first and latest reading, a reading in the last 10 years, and at least 6 readings. This site calls a well like that a qualifying well. Most counties do not have one. ${fmt(none.length)} of the ${fmt(COVERAGE_TOTAL)} counties on this site fall short, and about ${(popNone / 1e6).toFixed(0)} million people live in them, roughly ${Math.round(popNone / popAll * 100)}% of the country.</p><p>That does not mean the county has no groundwater, and it does not mean nobody has ever measured it. USGS may have wells there that were read a handful of times, or read for years and then dropped. State agencies and water districts often keep their own records that never reach the federal database. What it means is that this site found nothing long and recent enough to draw a trend from, so it does not invent one.</p>`,
          },
          {
            h2: 'It is not only quiet rural places',
            html: `<p>You might expect the gaps to be in empty counties, and partly they are: the typical county without a qualifying well has about ${fmt(median(none.map((r) => Number(r.population))))} people, against about ${fmt(median(rows.filter((r) => hasQualifyingWell(r)).map((r) => Number(r.population))))} in counties with one. But some of the biggest counties in the country are on the list too, including ${bigNone.map(link).join(', ')}. A large population does not guarantee a long-running federal monitoring well, so a big county with no number here is not a sign that anything is wrong there, only that this particular record is missing.</p><p>Coverage also depends a lot on the state, because USGS runs many of these wells together with state agencies and each state chooses how many to keep up. Among states with 20 or more counties, the lowest share covered is in ${low.map(covLine).join(', ')}. The highest is in ${high.map(covLine).join(', ')}.</p>`,
          },
          {
            h2: 'What a county page shows instead',
            html: `<p>When a county has no qualifying well, its page shows the trend at the closest county that does have one, measured as a straight line between the two counties' centers. It is labeled as the neighbor's reading every time and is never passed off as the county's own.</p><p>For most of these counties the neighbour is close. Half are within ${fmt(median(miles))} miles of a qualifying well, ${fmt(within30)} are within 30 miles and ${fmt(within60)} are within 60. ${fmt(crossState)} of them borrow from a county in another state, which is fine, because water underground does not stop at a state line.</p><p>Past ${NEARBY} miles the page stops borrowing. A well that far away says more about its own area than about yours, so those ${tooFar.length} county pages say plainly that there is no useful nearby record. They are in ${(() => { const c = {}; for (const x of tooFar) c[x.r.state_name] = (c[x.r.state_name] || 0) + 1; const e = Object.entries(c).sort((a, b) => b[1] - a[1]); return e.length > 1 ? `${e.slice(0, -1).map(([n, k]) => `${n} (${k})`).join(', ')} and ${e.at(-1)[0]} (${e.at(-1)[1]})` : `${e[0][0]} (${e[0][1]})`; })()}. The most remote is the Aleutians West Census Area in Alaska (Alaska has no counties, so the Census Bureau divides it into areas like this one that stand in for them). It is more than a thousand miles from the nearest qualifying well.</p>`,
          },
          {
            h2: 'How much to trust a neighbor\'s well',
            html: `<p>Less than your own county's well, and even that is only a starting point. Two wells a short drive apart can tell very different stories. One may draw from shallow sand and gravel that refills after a wet spring. The other may reach down to a deep layer of rock that a city or a field of irrigation wells has been pumping for decades. Their water levels can move in opposite directions.</p><p>So read the neighbor's number as a hint about the region. If your home is on a private well, check it against something closer to home:</p><ul><li>Your own well record. The company that drilled your well filed a report with the state, often called a driller's log or well log, listing how deep the well goes and where the water stood when it was drilled. Most states let you search these free on the website of the state's water, geology or natural resources department.</li><li>A measurement in your own well. A licensed well contractor can measure where your water stands today. Comparing that with the level on the driller's log tells you how far it has moved since the well was drilled.</li><li>Your state's own monitoring. Some states keep observation wells that never made it into the federal data used here.</li></ul><p>If a neighbor's county is dropping and your well log is old, that is a good reason to get a measurement. Once you have those numbers, the ${guideLink('well-pump-risk', 'guide to well pumps on this site')} shows how to work out how much water is left above your pump.</p>`,
          },
          {
            h2: 'When the water level reads above the ground',
            html: `<p>A few county pages show a minus sign in front of the depth. That is a real reading, not a mistake. It comes from an artesian well, which taps water trapped under a layer of clay or rock and held under pressure. Drill through that cap and the water rises up the pipe on its own, and in some wells it rises past the top of the ground. Fit a tall enough pipe and the water would stand that many feet above the ground, so the site writes the depth as a negative number. A depth of minus 10 feet means the pressure would push the water 10 feet up a pipe above the ground.</p><p>${fmt(artesian.length)} of the monitoring wells on this site read that way at their latest measurement.${highest ? ` The highest is in ${aLink(highest)}, where water would stand about ${fmt(Math.abs(highest.s.currentDepthFt))} feet above the ground.` : ''} Most of the others are a few feet to a few dozen feet above it.</p>`,
          },
          {
            h2: 'How to read the trend on an artesian well',
            html: `<p>On an artesian well, what matters is whether the water still rises as high as it used to. If it rises less high each year, the pressure underground is weakening. The county page shows that the same way it shows any other drop: as feet lost per decade, marked as dropping. If the water rises higher than it used to, the page marks it as rising.</p><p>Of the ${fmt(artesian.length)} artesian wells here, ${fmt(losing.length)} are losing pressure, ${fmt(gaining.length)} are gaining it and the rest are within ${STABLE_BAND_FT_PER_DECADE} feet per decade either way, which the site counts as stable.${fastLoss ? ` The fastest loss is in ${aLink(fastLoss)}, where the water rises about ${ft(fastLoss.s.trendFtPerDecade)} feet less high every ten years. (Louisiana is divided into parishes instead of counties; they work the same way.)` : ''}</p><p>If your own well flows by itself, a falling trend in your county matters in a specific way. As the pressure drops, a flowing well can slow down and then stop flowing at the surface, and the house then needs a pump to get water out. Flowing wells that run all the time also waste the pressure everyone nearby relies on, which is why some states require owners to cap them or fit a valve. Your state's water or natural resources department can tell you the rule where you live.</p><p>How each trend is calculated, and the full bar a well has to clear, is in the ${guideLink('methodology', 'methodology guide')}. To see your own county, ${pageLink('', 'search for it on the home page')}.</p>`,
          },
        ];
      })(),
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
// The ground cross-section: sky, soil, the water table, saturated rock.
const STRATA = `<svg class="wt-strata" viewBox="0 0 1440 520" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path class="s-top" d="M0 58 C180 40 330 70 520 54 S880 34 1080 52 1340 66 1440 50 V150 H0Z"/>
    <path class="s-clay" d="M0 150 H1440 V236 C1250 252 1060 222 860 240 S420 262 0 236Z"/>
    <path class="s-sand" d="M0 236 C420 262 640 228 860 240 S1250 252 1440 236 V300 C1180 316 980 290 720 304 S260 318 0 300Z"/>
    <path class="s-wet" d="M0 300 C260 318 460 290 720 304 S1180 316 1440 300 V520 H0Z"/>
    <path class="s-line" d="M0 300 C260 318 460 290 720 304 S1180 316 1440 300"/>
    <rect class="s-well" x="1118" y="30" width="9" height="380"/>
    <rect class="s-screen" x="1118" y="330" width="9" height="80"/>
  </svg>`;

export function homeHtml({ headline, lede, placeholder, noun, count, browseLinks }) {
  const bands = SEVERITY_TIERS_ORDERED.filter((t) => t !== 'no-data').map((tier) => {
    const members = trended.filter((r) => summaryBySlug.get(r.slug).severityTier === tier);
    const mid = members[Math.floor(members.length / 2)];
    return { tier, label: TIER_META[tier].short, n: members.length, example: mid };
  }).filter((b) => b.n > 0);
  const totalBanded = bands.reduce((a, b) => a + b.n, 0);
  const worstDeclining = trended[trended.length - 1];

  // [R5][R6][R7] The homepage is one cross-section of the ground, edge to
  // edge: sky, soil, the water table, the saturated rock under it. The search
  // sits on the surface where a well would be drilled, and the national
  // distribution sits down in the water itself. Flat fills only, no gradient.
  return `
<section class="wt-scene">
  ${STRATA}
  <div class="wt-surface">
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
  </div>
  <a class="wt-name" href="/">${site.name}</a>
  <div class="wt-under">
    <p class="wt-tablelabel">Water table</p>
    <h2>Where the ${totalBanded.toLocaleString()} counties with a trend actually land</h2>
    <div class="wt-band" role="list">
      ${bands.map((b) => `<a role="listitem" class="wt-seg wt-seg-${b.tier}" style="flex-grow:${b.n}"
        href="${b.example ? `/${b.example.slug}` : '#find'}">
        <span class="wt-seg-n">${b.n.toLocaleString()}</span>
        <span class="wt-seg-l">${b.label}</span>
      </a>`).join('\n      ')}
    </div>
    <p class="wt-cap">Each block is sized by how many counties fall in it, from USGS's own well
    readings${worstDeclining ? `. The fastest decline on record is in ${worstDeclining.county}, ${worstDeclining.state}` : ''}.</p>
  </div>
</section>

<div class="wt-read">
  <section>
    <h2>Only ${COVERAGE_PCT}% of counties have an answer</h2>
    <p>USGS has a monitoring well with enough history to call a trend for ${COVERAGE_WITH_DATA.toLocaleString()}
    of ${COVERAGE_TOTAL.toLocaleString()} US counties. The rest get a page that says so plainly instead of a
    number borrowed from somewhere else.</p>
  </section>
  <section>
    <h2>If your county turns out to be declining</h2>
    <p>A dropping water table means a residential pump reaches deeper and works harder, which shortens its life
    long before the well itself runs dry. That is a different, more useful question than "will it run dry," and
    every declining county's page names the pace of decline so you can judge it rather than guess.</p>
  </section>
</div>

<details class="browse wt-browse">
  <summary>Browse all ${count.toLocaleString()} counties by state</summary>
  <ul class="hublist">
${browseLinks}
  </ul>
</details>`;
}

// [R5][R20] No top bar of any kind, not even a centred name: the first
// screen opens on the visitor's question. The name and navigation live in
// the footer; the homepage carries the name inside the scene.
export function masthead() {
  return '';
}

/** CSS for the above. Owned by this site, not the factory. */
export const styles = `
header.wt-mast{border:0; background:none; text-align:center; padding:34px 22px 0}
.wt-mast-name{display:inline-flex; align-items:center; gap:10px; color:var(--ink); text-decoration:none;
  font-size:.86rem; letter-spacing:.24em; text-transform:uppercase; font-weight:600}
.wt-mast-name svg{width:22px; height:22px}
body.home main{max-width:none; padding:0}
.wt-scene{position:relative; min-height:max(640px,92vh); display:flex; flex-direction:column; overflow:hidden;
  background:#eef1ee}
.wt-strata{position:absolute; left:0; right:0; bottom:0; width:100%; height:58%}
.s-top{fill:#b9a789} .s-clay{fill:#9c7f5f} .s-sand{fill:#c9b28a} .s-wet{fill:#4f6f7d}
.s-line{fill:none; stroke:#cfe3ea; stroke-width:3; vector-effect:non-scaling-stroke}
.s-well{fill:#3a3d40} .s-screen{fill:#cfe3ea; opacity:.6}
.wt-surface{position:relative; display:grid; grid-template-columns:minmax(0,7fr) minmax(0,5fr);
  column-gap:6vw; align-items:end; padding:64px 6vw 0}
.wt-surface h1{grid-column:1 / -1; font-size:clamp(2.3rem,5.6vw,4.4rem); line-height:1.04; letter-spacing:-.026em;
  margin:0 0 34px; max-width:20ch; color:#1c2427}
.wt-surface .finder{grid-column:1; max-width:none; margin:0; padding:0; background:none; border:0;
  border-radius:0; box-shadow:none}
.wt-surface .finder-row{gap:0; border-bottom:2px solid #1c2427}
.wt-surface .finder input, .wt-surface #q{margin:0; background:transparent; border:0; border-radius:0; padding:.55em 0;
  font-size:1.25rem; color:#1c2427}
.wt-surface .finder input:focus{box-shadow:none}
.wt-surface .finder button{background:none; color:#1c2427; border-radius:0; padding:.55em 0 .55em 1em;
  font-size:1rem; text-decoration:underline; text-underline-offset:4px}
.wt-surface .finder-h{color:#4a5559}
.wt-lede{grid-column:2; color:#3e4a4f; font-size:1rem; line-height:1.6; margin:0 0 6px}
.wt-name{position:absolute; right:calc(22.4% + 26px); top:calc(42% + 70px); z-index:1;
  font-family:var(--display, inherit); font-size:1.15rem; color:#3a2f22; text-decoration:none; font-style:italic}
.wt-under{position:relative; margin-top:auto; padding:0 6vw 40px; color:#eaf2f4}
.wt-tablelabel{margin:0 0 4px; font-size:.78rem; color:#cfe3ea; font-style:italic}
.wt-under h2{color:#f4f8f9; font-size:1.15rem; margin:0 0 14px}
.wt-band{display:flex; gap:3px; flex-wrap:wrap}
.wt-seg{display:flex; flex-direction:column; justify-content:flex-end; gap:4px; min-width:70px;
  padding:18px 12px 12px; text-decoration:none; min-height:96px}
.wt-seg-n{font-size:1.45rem; font-weight:600; letter-spacing:-.01em}
.wt-seg-l{font-size:.76rem; line-height:1.3; opacity:.9}
.wt-seg-declining-severe{background:#f3d9d2; color:#7a2a17}
.wt-seg-declining-moderate{background:#f1e4c8; color:#6b4b10}
.wt-seg-declining-mild{background:#e6ece4; color:#34503a}
.wt-seg-stable{background:#dfe6e8; color:#334247}
.wt-seg-rising{background:#cfe3ea; color:#1f4a5a}
.wt-seg:hover{filter:brightness(0.94)}
.wt-cap{font-size:.82rem; color:#cfe3ea; margin:10px 0 0; max-width:none}
.wt-read{display:grid; grid-template-columns:5fr 7fr; gap:7vw; padding:64px 6vw 20px; max-width:1300px}
.wt-read h2{font-size:1.4rem; margin:0 0 .5em}
.wt-read p{font-size:1rem; line-height:1.65}
.wt-browse{margin:24px 6vw 64px; max-width:1300px}
body.home main > section > h2{margin-top:0}
/* [R5][R20] County pages: the question and the number own the first screen,
   edge to edge, on the ground cross-section; the rest reads across the width,
   heading left and answer right, not in a narrow centred column. */
main:has(.wt-hero){max-width:none; padding:0}
main:has(.wt-hero) > h1{margin:0; padding:40px 6vw 0; background:#eef1ee; color:#1c2427;
  font-size:clamp(2.4rem,5.4vw,4.6rem); line-height:1.02; letter-spacing:-.026em; max-width:none}
main:has(.wt-hero) > section{margin:0}
.wt-hero{position:relative; min-height:max(560px,74vh); padding:28px 6vw calc(30vh + 32px); background:#eef1ee; overflow:hidden}
.wt-hero .wt-strata{position:absolute; left:0; right:0; bottom:0; width:100%; height:30vh}
.wt-hero-num{position:relative; display:flex; align-items:center; gap:28px; flex-wrap:wrap}
.wt-big{font-size:clamp(7rem,16vw,14.5rem); line-height:.86; font-weight:700; letter-spacing:-.04em; color:#1c2427}
.wt-note{margin:0; font-size:clamp(1.25rem,1.9vw,1.6rem); line-height:1.35; color:#1c2427; max-width:22ch}
.wt-means{position:relative; margin:22px 0 0; font-size:clamp(1.5rem,2.6vw,2.2rem); line-height:1.2; color:#7a2a17;
  font-weight:600; max-width:30ch}
.wt-stale{position:relative; margin:14px 0 0; font-size:1.3rem; color:#6b4b10; max-width:44ch}
.wt-do{position:relative; margin:14px 0 0; font-size:1.3rem; line-height:1.4; color:#3e4a4f; max-width:44ch}
main:has(.wt-hero) > section:not(:first-of-type){display:grid; grid-template-columns:minmax(0,4fr) minmax(0,8fr);
  column-gap:6vw; padding:40px 6vw; border-top:1px solid #d9dfdc}
main:has(.wt-hero) > section:not(:first-of-type) > h2{margin:0; font-size:1.7rem; line-height:1.15}
main:has(.wt-hero) > section:not(:first-of-type) > :not(h2){grid-column:2; font-size:1.25rem; line-height:1.6; max-width:52ch}
main:has(.wt-hero) > section:not(:first-of-type) > :not(h2):first-child{grid-column:2}
main:has(.wt-hero) .cta, main:has(.wt-hero) .disclosure{background:none; border:0; border-radius:0; padding:0; box-shadow:none}
@media (max-width:760px){
  .wt-scene{min-height:0}
  .wt-surface{grid-template-columns:minmax(0,1fr); padding:36px 20px 0; row-gap:18px}
  .wt-surface h1{margin:0}
  .wt-lede{grid-column:1}
  .wt-name{display:none}
  .wt-strata{position:relative; order:1; height:170px; margin-top:28px; flex:none}
  .wt-surface{order:0}
  .wt-under{order:2; margin-top:0; padding:4px 20px 28px; background:#4f6f7d}
  .wt-seg{min-width:45%; flex-grow:1 !important}
  .wt-read{grid-template-columns:1fr; gap:8px; padding:40px 20px 8px}
  .wt-browse{margin:16px 20px 48px}
  main:has(.wt-hero) > h1{padding:28px 20px 0; font-size:2.4rem}
  .wt-hero{min-height:0; padding:18px 20px 150px}
  .wt-hero .wt-strata{height:130px}
  .wt-hero-num{gap:10px 18px}
  main:has(.wt-hero) > section:not(:first-of-type){grid-template-columns:minmax(0,1fr); padding:30px 20px}
  main:has(.wt-hero) > section:not(:first-of-type) > :not(h2){grid-column:1; font-size:1.25rem}
  main:has(.wt-hero) > section:not(:first-of-type) > h2{margin-bottom:12px}
}
`;
