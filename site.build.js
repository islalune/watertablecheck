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
  'declining-moderate': { badge: 'mid', word: 'dropping at about the usual rate for a county that is losing water', short: 'Declining, typical pace' },
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
      `One well stands in for all the underground water in ${county}, and the water under your land can behave differently.`,
      `This is one well, not a survey of the whole county, so wells a few miles apart can tell different stories.`,
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
<p class="wt-note">${feet} per decade ${flat ? 'of change' : falling ? 'deeper' : 'shallower'} since ${s.firstDate?.slice(0, 4)}.<br>Last read ${s.lastDate}, U.S. Geological Survey well ${s.wellId}.</p></div>
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
        `Which wells count and how the trend line is drawn are explained in the ${guideLink('methodology', 'methodology guide')}.</p>`,
    });

    // --- [R3][R10] how far to trust this number, from this well's own record ---
    // A visitor deciding on a $10,000 well needs to know whether the trend is
    // drawn through 900 readings or 20. Both branches come from the row itself.
    {
      const n = Number(s.nMeasurements);
      const span = Math.max(Number(s.spanYears), 1);
      const perYear = n / span;
      const firstYear = Number(s.firstDate?.slice(0, 4));
      const trust = [];
      if (perYear >= 6) {
        trust.push(`This well has been read ${n.toLocaleString('en-US')} times in ${Math.round(span)} years, about ${Math.round(perYear)} readings a year. With that many points, one odd reading cannot drag the trend line far, and the ups and downs between wet and dry seasons show up in the record instead of being mistaken for a long fall or rise.`);
      } else if (perYear >= 1) {
        trust.push(`Someone measured this well roughly ${perYear < 1.5 ? 'once' : `${Math.round(perYear)} times`} a year, ${n.toLocaleString('en-US')} readings in all. That is enough to see which way the water is heading. Single readings still bounce around the line, because a measurement taken late in a dry summer sits lower than one taken after a wet spring.`);
      } else {
        trust.push(`There are only ${n.toLocaleString('en-US')} readings across ${Math.round(span)} years here, so years went by between visits. The line is drawn through few points, which makes the direction more trustworthy than the exact ${ft(Math.abs(s.trendFtPerDecade))} feet. If one of those few visits fell in a drought, it pulls the line more than it would in a busier record.`);
      }
      if (firstYear && firstYear < 1960) {
        trust.push(`The record goes back to ${firstYear}, so it runs through many droughts and wet decades. A single bad summer barely shifts a line that long.`);
      } else if (firstYear && firstYear >= 2000) {
        trust.push(`Readings only start in ${firstYear}. That clears the 15-year bar, but on a record this short a run of dry or wet years near either end tilts the trend more than it would on a well measured since the 1950s.`);
      }
      blocks.push({
        h2: `How much weight ${county}'s number can carry`,
        html: trust.map((p) => `<p>${p}</p>`).join('\n'),
      });
    }

    // --- national rank, genuinely per-row-unique ------------------------------
    const rr = trendRank.get(slug);
    const rankLine = pick(slug + '-rank', [
      `Of the ${TRENDED_TOTAL.toLocaleString('en-US')} US counties with a usable trend, ${county} ranks ${ordinal(rr)} ` +
        `from fastest-rising to fastest-falling. ${rr > TRENDED_TOTAL * 0.66 ? 'Near the bottom of that list means the water here is dropping faster than in most of the country.' : rr < TRENDED_TOTAL * 0.33 ? 'Near the top of that list means the water here is doing better than in most of the country.' : 'That is close to the middle of the country.'}`,
      `${county} sits at rank ${ordinal(rr)} of ${TRENDED_TOTAL.toLocaleString('en-US')} ranked counties, ordered ` +
        `rising-to-declining. ${rr > TRENDED_TOTAL * 0.66 ? 'That puts it in the third of the country where the water is falling fastest.' : rr < TRENDED_TOTAL * 0.33 ? 'That puts it in the third of the country where the water is rising or holding best.' : 'That puts it in the middle third of the country.'}`,
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
    {
      slug: 'water-table-by-state',
      title: `Is the Water Table Dropping in Your State? Every State and Territory Compared`,
      description: `How many counties in each US state, plus Washington DC and Puerto Rico, have underground water dropping, holding steady or rising, from the same USGS monitoring wells behind every county page, and where the state picture has big gaps.`,
      // [R2][R3][R10][R29] Answers the state-level question the county pages
      // raise ("is this just my county?"). Every figure is computed from the
      // same county rows the pages use, so the guide cannot drift.
      blocks: (() => {
        const fmt = (n) => Math.round(n).toLocaleString('en-US');
        const andList = (xs) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
        const stateOf = new Map();
        for (const r of rows) {
          const name = r.state_name || (r.state === 'PR' ? 'Puerto Rico' : r.state);
          if (!stateOf.has(r.state)) stateOf.set(r.state, { code: r.state, name, total: 0, list: [] });
          stateOf.get(r.state).total++;
        }
        for (const [code, list] of trendedByState) {
          stateOf.get(code).list = list.map((r) => ({ r, s: summaryBySlug.get(r.slug) }));
        }
        const states = [...stateOf.values()].map((st) => {
          const t = st.list.map((x) => x.s.trendFtPerDecade);
          const down = st.list.filter((x) => x.s.severityTier.startsWith('declining'));
          const up = st.list.filter((x) => x.s.severityTier === 'rising');
          const fastest = [...down].sort((a, b) => b.s.trendFtPerDecade - a.s.trendFtPerDecade)[0] || null;
          return { ...st, n: st.list.length, down: down.length, up: up.length,
            steady: st.list.length - down.length - up.length,
            med: t.length ? median(t) : null, fastest };
        }).sort((a, b) => a.name.localeCompare(b.name));
        const solid = states.filter((s) => s.n >= 10);
        const mostlyDown = solid.filter((s) => s.down / s.n >= 0.5)
          .sort((a, b) => b.down / b.n - a.down / a.n);
        const mostlySteady = solid.filter((s) => s.steady / s.n >= 0.7)
          .sort((a, b) => b.steady / b.n - a.steady / a.n);
        const moreUp = solid.filter((s) => s.up > s.down).sort((a, b) => b.up - a.up);
        const thin = states.filter((s) => s.total >= 50 && s.n / s.total < 0.25)
          .sort((a, b) => a.n / a.total - b.n / b.total);
        const pct = (a, b) => Math.round((a / b) * 100);
        const link = ({ r, s }) => pageLink(r.slug, `${s.county}`);
        const kansas = stateOf.get('KS') && states.find((s) => s.code === 'KS');
        const texas = states.find((s) => s.code === 'TX');
        const nDown = trended.filter((r) => summaryBySlug.get(r.slug).severityTier.startsWith('declining')).length;
        const stateLine = (s) => {
          if (!s.n) return `<li><strong>${s.name}</strong>: none of its ${fmt(s.total)} ${s.total === 1 ? 'county has' : 'counties have'} a qualifying monitoring well yet.</li>`;
          const thinNote = s.fastest && s.fastest.s.nMeasurements < 12 ? ` That line rests on only ${fmt(s.fastest.s.nMeasurements)} readings${Number(String(s.fastest.s.lastDate).slice(0, 4)) < 2021 ? `, the last in ${String(s.fastest.s.lastDate).slice(0, 4)}` : ''}, so one odd reading can tilt it this far; open the raw readings before trusting it.` : '';
          const f = s.fastest ? ` Fastest drop: ${link(s.fastest)}, ${ft(s.fastest.s.trendFtPerDecade)} feet per decade.${thinNote}` : '';
          return `<li><strong>${s.name}</strong>: ${fmt(s.n)} of ${fmt(s.total)} ${s.total === 1 ? 'county' : 'counties'} measured. ${fmt(s.down)} dropping, ${fmt(s.steady)} steady, ${fmt(s.up)} rising.${f}</li>`;
        };
        return [
          {
            h2: 'What this page compares',
            html: `<p>Under most of the country, water fills the cracks and gaps in the soil and rock some distance below the ground. The top of that water is called the water table. A household well works by reaching down past it, so if the water table sinks, the well has to reach further to find water.</p><p>The U.S. Geological Survey (USGS), the federal science agency that tracks the country's water, keeps monitoring wells: wells nobody drinks from, measured over and over for years so anyone can see whether the water is sinking or coming back up. This site, ${site.name}, is a free lookup that reads those wells. It picks one such well for each county that has a long enough record and draws a straight line through its readings. That line tells you how many feet the water has moved per decade. One well cannot speak for every property in a large county, since your well may tap a different layer of rock, but a well read for fifteen years or more shows which way the water in that area has been heading. ${pageLink('', 'Search for your county on the home page')} to see your own.</p><p>This page adds those county answers up by state. ${fmt(TRENDED_TOTAL)} counties have a qualifying well, and ${fmt(nDown)} of them are dropping. A county counts as steady here when its water moves less than ${STABLE_BAND_FT_PER_DECADE} feet per decade in either direction, which is too small to matter to a well.</p>`,
          },
          {
            h2: 'States where most measured counties are dropping',
            html: `<p>Among states with at least ten measured counties, these have half or more of them dropping:</p><ul>${mostlyDown.map((s) => `<li><strong>${s.name}</strong>: ${fmt(s.down)} of ${fmt(s.n)} measured counties dropping (${pct(s.down, s.n)}%), with the typical county moving ${ft(s.med)} feet per decade${s.fastest ? `. The fastest is ${link(s.fastest)}, at ${ft(s.fastest.s.trendFtPerDecade)} feet per decade` : ''}.</li>`).join('')}</ul><p>The list mixes dry Western states, where farms and growing towns pump from deep layers of water-bearing rock (called aquifers) that rain and snow refill slowly, with wetter Southern and Midwestern states where irrigation and town supplies draw on the same deep layers. "Half the counties dropping" does not mean every well there is in trouble. The typical drop in most of these states is a foot or two per decade, which a well with plenty of water above its pump can absorb for a long time. The ${guideLink('well-pump-risk', 'well-pump guide')} shows how to check that cushion for your own well.</p>`,
          },
          {
            h2: 'States where the water is mostly holding steady',
            html: `<p>${mostlySteady.length ? `In ${andList(mostlySteady.map((s) => `${s.name} (${fmt(s.steady)} of ${fmt(s.n)} steady)`))}, at least seven in ten measured counties are neither dropping nor rising in any way that matters.` : ''} These are mostly wetter states in the Northeast and upper Midwest, where shallow wells draw from sand, gravel and cracked rock that rain refills every year. Water levels there rise in spring and sink in late summer, but over fifteen years or more the line through the readings stays nearly flat.</p><p>A steady county can still have a dry well. A drought summer can drop a shallow well below its pump for a few weeks even when the long-term line is flat, and a single house well can fail for reasons that have nothing to do with the water table, like a worn pump or a clogged screen. The county line tells you whether the water is slowly leaving. It does not tell you about one bad season.</p>`,
          },
          {
            h2: 'States where more counties are rising than dropping',
            html: `<p>${moreUp.length ? `In ${andList(moreUp.map((s) => `${s.name} (${fmt(s.up)} rising, ${fmt(s.down)} dropping)`))}, more measured counties have water coming back toward the surface than sinking.` : 'No state with ten or more measured counties has more rising than dropping.'}</p><p>Water usually comes back when less is pumped out than rain and snow put in: a town switches its supply from wells to a river or reservoir, a big industrial user closes, or a region has a run of wet years. For a well owner that is good news. Where the water rises to within a few feet of the ground, it can seep into basements or keep a septic field from draining. This site tracks how far down the water stands, not flooding, so a rising county is mainly a reason to check that if your house sits low.</p>`,
          },
          {
            h2: 'Where the state picture has big gaps',
            html: `<p>A state's numbers are only as good as the counties that have a qualifying monitoring well, and some large states have very few. ${thin.length ? `${andList(thin.map((s) => `${s.name} (${fmt(s.n)} of ${fmt(s.total)} counties)`))} ${thin.length === 1 ? 'has' : 'have'} a qualifying well in fewer than one county in four.` : ''}</p><p>${kansas ? `Kansas is the sharpest example. Western Kansas sits on the High Plains aquifer, the huge underground water supply that irrigates farms from South Dakota to Texas, and it is one of the places in the country where people most worry about wells going dry. Yet only ${fmt(kansas.n)} of its ${fmt(kansas.total)} counties have a federal monitoring well that clears this site's bar. ` : ''}${texas ? `Texas has ${fmt(texas.total)} counties and only ${fmt(texas.n)} qualify. ` : ''}That is not because nobody measures there. States run their own well-measuring programs, and many of those readings never reach the federal network this site reads from.</p><p>So if your state has few measured counties, look up your state's own groundwater data too. The Kansas Geological Survey and the Texas Water Development Board both publish water-level readings for free, and most other states have a water, geology or natural resources department that does the same. The ${guideLink('no-data-and-artesian-readings', 'no-data guide')} explains what a county page shows when it has no well of its own.</p>`,
          },
          {
            h2: 'Every state at a glance',
            html: `<p>Each line shows how many of the state's counties have a qualifying well, how they split, and the county dropping fastest. Puerto Rico's areas are called municipios, Louisiana's parishes and Alaska's boroughs; they are counted the same way as counties.</p><ul>${states.map(stateLine).join('')}</ul><p>How each county's line is drawn and the full bar a well has to clear are in the ${guideLink('methodology', 'methodology guide')}. The ${guideLink('fastest-moving-counties', 'fastest-moving counties guide')} ranks the most extreme counties nationally.</p>`,
          },
        ];
      })(),
    },
    {
      slug: 'how-deep-is-the-water-table',
      title: `How Deep Is the Water Table? What the Latest Readings Show, County by County`,
      description: `How far below the ground the water sits in every US county with a long-running government monitoring well, which states have the deepest and shallowest water, and what that depth means for a household well.`,
      // [R3][R10][R21][R29] Answers the visitor's second question in
      // visitor-job.md ("how deep is the water here right now?"). Every
      // figure is computed from the same county rows the pages use.
      blocks: (() => {
        const fmt = (n) => Math.round(n).toLocaleString('en-US');
        const link = (x) => pageLink(x.r.slug, `${x.s.county}, ${x.s.state}`);
        const withWell = rows.filter((r) => hasQualifyingWell(r)).map((r) => ({ r, s: summaryBySlug.get(r.slug) }));
        const measured = withWell.filter((x) => x.s.currentDepthFt !== null && x.s.currentDepthFt >= 0);
        const depths = measured.map((x) => x.s.currentDepthFt).sort((a, b) => a - b);
        const at = (p) => depths[Math.floor(p * (depths.length - 1))];
        const band = (lo, hi) => depths.filter((d) => d >= lo && d < hi).length;
        const artesian = withWell.filter((x) => x.s.isArtesian).length;
        const atSurface = measured.filter((x) => x.s.currentDepthFt < 1).length;
        const under25 = measured.filter((x) => x.s.currentDepthFt < 25);
        const over200 = measured.filter((x) => x.s.currentDepthFt > 200);
        const popOf = (xs) => xs.reduce((a, x) => a + (x.s.population || 0), 0);
        const millions = (n) => `${Math.round(n / 1e6)} million`;
        const byDir = (dir) => median(measured.filter((x) => x.r.direction === dir).map((x) => x.s.currentDepthFt));
        const deepAndDropping = over200.filter((x) => x.s.trendFtPerDecade >= 5).length;
        const shallowAndDropping = under25.filter((x) => x.s.trendFtPerDecade >= 2).length;
        const stateDepth = new Map();
        for (const x of measured) {
          const name = x.s.stateName || (x.s.state === 'PR' ? 'Puerto Rico' : x.s.state);
          if (!stateDepth.has(name)) stateDepth.set(name, []);
          stateDepth.get(name).push(x.s.currentDepthFt);
        }
        const stateMed = [...stateDepth].filter(([, v]) => v.length >= 10)
          .map(([name, v]) => ({ name, n: v.length, med: median(v) }))
          .sort((a, b) => b.med - a.med);
        const deepStates = stateMed.slice(0, 5);
        const shallowStates = stateMed.slice(-5).reverse();
        const deepest = [...measured].sort((a, b) => b.s.currentDepthFt - a.s.currentDepthFt).slice(0, 8);
        const deepLine = (x) => `<li>${link(x)}: ${ft(x.s.currentDepthFt)} feet down at its latest reading in ${String(x.s.lastDate).slice(0, 4)}, from ${fmt(x.s.nMeasurements)} readings</li>`;
        const fewReadings = deepest.filter((x) => x.s.nMeasurements < 12).map(link);
        const stateLine = (st) => `<li><strong>${st.name}</strong>: typically ${ft(st.med)} feet, across ${fmt(st.n)} measured counties</li>`;
        return [
          {
            h2: 'The short answer',
            html: `<p>In the typical US county with a long-running government monitoring well, the water sits about ${ft(at(0.5))} feet below the ground. Half of those counties fall between ${ft(at(0.25))} and ${ft(at(0.75))} feet. A few read far deeper: ${fmt(band(200, Infinity))} counties are past 200 feet, and the deepest well on the site reads ${ft(depths.at(-1))} feet.</p><p>Why care? If your home is on city water, this is background about your area's supply rather than your own taps. If it runs on a private well, it is more direct: the well only works while its pump sits below the water. The deeper the water and the faster it falls, the sooner a well may need a lower pump or a deeper hole. To see the number for your own county, ${pageLink('', 'search for it on the home page')}. The rest of this page explains what the number means, where water is deep or shallow, and why it can differ from what you find in your own well.</p>`,
          },
          {
            h2: 'What "depth to water" means',
            html: `<p>Dig far enough almost anywhere in the country and you reach ground that is soaked with water. The top of that soaked layer is the water table. Depth to water is the distance from the ground surface down to it, measured in a well. A household well has to reach below that point to pull any water up, and the pump has to sit lower still.</p><p>The readings here come from the U.S. Geological Survey (USGS), the federal science agency that tracks the country's water. Its staff and partner agencies lower a marked tape or an electric sensor into monitoring wells, which exist only to be measured, and record how far down the water stands. Each county page uses one such well, the one with the longest record, and prints its latest reading and the date it was taken. One well cannot describe every property in a large county, so read its depth as a baseline for the area, not a measurement of the ground under your house.</p>`,
          },
          {
            h2: 'How the counties spread out',
            html: `<p>Of the ${fmt(measured.length)} counties whose well gives a normal depth reading, this is how deep the water was at the latest reading:</p><ul><li>Under 10 feet: ${fmt(band(0, 10))} counties</li><li>10 to 25 feet: ${fmt(band(10, 25))}</li><li>25 to 50 feet: ${fmt(band(25, 50))}</li><li>50 to 100 feet: ${fmt(band(50, 100))}</li><li>100 to 200 feet: ${fmt(band(100, 200))}</li><li>200 to 400 feet: ${fmt(band(200, 400))}</li><li>Over 400 feet: ${fmt(band(400, Infinity))}</li></ul><p>So most measured counties have water within 50 feet of the surface, and the counties with very deep water are a small group. This list leaves out ${fmt(artesian)} wells where the water underground is under so much pressure that it pushes up the pipe above ground level by itself. These are called artesian wells, and they have no ordinary depth to report; the ${guideLink('no-data-and-artesian-readings', 'guide to artesian wells')} covers them. ${atSurface ? `Of the counties under 10 feet, ${fmt(atSurface)} read less than a foot, meaning the water stood at or just below the ground when it was last measured.` : ''}</p>`,
          },
          {
            h2: 'Where the water is deepest',
            html: `<p>Among states with at least ten measured counties, these have the deepest water in their typical county:</p><ul>${deepStates.map(stateLine).join('')}</ul><p>Dry climates explain part of it. Where little rain soaks in, the water table sits lower to begin with, and decades of pumping for farms and growing towns can pull it lower again. Geology explains the rest. Some monitoring wells are drilled into a deep layer of water-bearing rock, called an aquifer, because that is the layer towns and farms pump from, and their readings describe that deep layer rather than the shallow water a few feet under the lawn.</p><p>These are the eight deepest readings on the site:</p><ul>${deepest.map(deepLine).join('')}</ul><p>${fewReadings.length ? `${fewReadings.length === 1 ? fewReadings[0] + ' has' : fewReadings.slice(0, -1).join(', ') + ' and ' + fewReadings.at(-1) + ' have'} fewer than a dozen readings on record, so the depth is real but which way the water there is heading over the years is less certain. ` : ''}A deep reading at the county's monitoring well does not mean every well there must go that deep. It means the layer that well taps sits that far down, and anyone drilling into the same layer should expect to go at least as far.</p>`,
          },
          {
            h2: 'Where it is shallowest',
            html: `<p>At the other end, these states have the shallowest water in their typical measured county:</p><ul>${shallowStates.map(stateLine).join('')}</ul><p>These are mostly wet states, or places with flat land, sandy soil and lots of lakes and rivers that keep the ground topped up. About ${millions(popOf(under25))} people live in counties whose well reads under 25 feet, compared with about ${millions(popOf(over200))} in counties past 200 feet.</p><p>Shallow water is easy to reach, which is why older wells in these areas are often shallow too. That cuts both ways. A shallow well costs less to drill, but it also has less water above its pump, so even a modest drop or a dry summer can leave it short. ${fmt(shallowAndDropping)} counties have water under 25 feet that is also getting deeper by at least 2 feet per decade, which is the combination a shallow-well owner should watch most closely: if the water falls below the pump, the taps run dry until the pump is lowered or the well is deepened.</p>`,
          },
          {
            h2: 'Deep water and dropping water often go together',
            html: `<p>In counties where the water table is dropping, the typical well reads ${ft(byDir('declining'))} feet. In counties where it is holding steady, the typical well reads ${ft(byDir('stable'))} feet, and in counties where it is rising, ${ft(byDir('rising'))} feet.</p><p>That is not a coincidence. Shallow water near the surface refills every year from rain and snowmelt, so it tends to bob up and down without going anywhere. Deep layers refill much more slowly, so when a city or a field of irrigation wells pumps from one for decades, the level keeps falling. ${fmt(deepAndDropping)} counties have water more than 200 feet down that is also getting deeper by 5 feet or more every ten years. Our ${guideLink('fastest-moving-counties', 'guide to the counties where water levels are changing fastest')} lists the most extreme of them.</p>`,
          },
          {
            h2: 'Why your own well can read differently',
            html: `<p>The county number is the depth at one government well, on the day it was last measured. Your well can read quite differently for a few ordinary reasons:</p><ul><li>Ground height. Depth is measured from the ground at each well. If your house sits on a hill 40 feet above the monitoring well, your water may be roughly 40 feet further down even though it is the same water underground.</li><li>A different layer. Your well may draw from a shallower or deeper aquifer than the monitoring well, and the two can sit at very different levels.</li><li>Nearby pumping. A well close to a town's supply wells or a large irrigation system can read lower while those pumps are running.</li><li>The season. Water levels usually drop through a dry summer and recover in a wet spring, so a single reading depends on when it was taken.</li></ul><p>The number that settles it is the level in your own well. Your driller's log (the report the company that drilled your well filed with the state) lists how deep the well goes and where the water stood when it was drilled. Most states let you search these logs free; searching for your state's name plus "well log search" usually finds the page, which is run by the state's water, geology or natural resources department. A licensed well contractor can measure today's level for you. Compare the two, then use the ${guideLink('well-pump-risk', 'well-pump guide')} to see how much water is left above your pump.</p>`,
          },
          {
            h2: 'Where these numbers come from',
            html: `<p>Every depth on this page is the latest reading from the same USGS monitoring wells behind the county pages, from the National Water Information System and the National Ground-Water Monitoring Network, both free and public. Some readings are years old; each county page shows the date of its latest one and warns on the first screen when it is more than about five years old. Which wells count, and how the trend is drawn, is in the ${guideLink('methodology', 'methodology guide')}. The ${guideLink('water-table-by-state', 'state-by-state guide')} shows which way the water is moving in each state.</p>`,
          },
        ];
      })(),
    },
    {
      slug: 'cities-vs-countryside',
      title: `Is the Water Table Dropping Faster Where More People Live?`,
      description: `Whether big cities or small rural counties are losing groundwater, measured across every US county with a long-running government monitoring well, and what the answer means if your house runs on a private well.`,
      // [R3][R10][R21][R29] Answers a question the county rows raise on their
      // own: does population predict a falling water table? Every figure is
      // computed from the same rows the county pages use.
      blocks: (() => {
        const fmt = (n) => Math.round(n).toLocaleString('en-US');
        const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
        const one = (n) => (Math.round(n * 10) / 10).toFixed(1);
        const link = (x) => pageLink(x.r.slug, `${x.s.county}, ${x.s.state}`);
        const all = rows.map((r) => ({ r, s: summaryBySlug.get(r.slug), pop: Number(r.population) || 0 }));
        const withWell = all.filter((x) => hasQualifyingWell(x.r) && x.s.trendFtPerDecade !== null);
        const nowYear = Math.max(...withWell.map((x) => Number(String(x.r.last_date).slice(0, 4))));
        const isStale = (x) => nowYear - Number(String(x.r.last_date).slice(0, 4)) > 5;
        const dropping = (x) => x.r.direction === 'declining';
        const rising = (x) => x.r.direction === 'rising';
        const BANDS = [
          [0, 10000, 'under 10,000 people'],
          [10000, 25000, '10,000 to 25,000'],
          [25000, 50000, '25,000 to 50,000'],
          [50000, 100000, '50,000 to 100,000'],
          [100000, 250000, '100,000 to 250,000'],
          [250000, 1000000, '250,000 to 1 million'],
          [1000000, Infinity, 'over 1 million'],
        ];
        const bands = BANDS.map(([lo, hi, label]) => {
          const inBand = (x) => x.pop >= lo && x.pop < hi;
          const g = withWell.filter(inBand);
          const d = g.filter(dropping);
          return {
            label,
            total: all.filter(inBand).length,
            n: g.length,
            dropPct: pct(d.length, g.length),
            risePct: pct(g.filter(rising).length, g.length),
            medDrop: d.length ? median(d.map((x) => x.s.trendFtPerDecade)) : 0,
          };
        });
        const most = bands.reduce((a, b) => (b.dropPct > a.dropPct ? b : a));
        const least = bands.reduce((a, b) => (b.dropPct < a.dropPct ? b : a));
        const small = bands[0];
        const huge = bands[bands.length - 1];
        const big = withWell.filter((x) => x.pop >= 1000000);
        const bigDrop = big.filter(dropping).sort((a, b) => b.s.trendFtPerDecade - a.s.trendFtPerDecade);
        const bigRise = big.filter(rising).sort((a, b) => a.s.trendFtPerDecade - b.s.trendFtPerDecade);
        const bigStable = big.length - bigDrop.length - bigRise.length;
        const fastest = withWell.filter(dropping).sort((a, b) => b.s.trendFtPerDecade - a.s.trendFtPerDecade).slice(0, 15);
        const fastSmall = fastest.filter((x) => x.pop < 100000).length;
        const sumPop = (g) => g.reduce((t, x) => t + x.pop, 0);
        const popDrop = sumPop(withWell.filter(dropping));
        const popNone = sumPop(all.filter((x) => !hasQualifyingWell(x.r)));
        const bigNote = (x) => {
          const t = x.s.trendFtPerDecade;
          const bits = [t < 0 ? `rising ${one(-t)} feet per decade` : `${one(t)} feet per decade`];
          if (Number(x.r.n_measurements) < 20) bits.push(`only ${x.r.n_measurements} readings`);
          if (isStale(x)) bits.push(`last read in ${String(x.r.last_date).slice(0, 4)}`);
          return `${link(x)} (${bits.join(', ')})`;
        };
        const table = `<table><thead><tr><th>County population</th><th>Counties with a long-term monitoring well</th><th>Share dropping</th><th>Share steady</th><th>Share rising</th><th>Typical drop where it is dropping</th></tr></thead><tbody>${bands
          .map((b) => `<tr><td>${b.label}</td><td>${fmt(b.n)} of ${fmt(b.total)}</td><td>${b.dropPct}%</td><td>${100 - b.dropPct - b.risePct}%</td><td>${b.risePct}%</td><td>${one(b.medDrop)} ft per decade</td></tr>`)
          .join('')}</tbody></table>`;
        return [
          {
            h2: 'The short answer',
            html: `<p>It depends on what you mean by faster. Small rural counties are more likely to have a falling water table. But when a big county's water is dropping, it usually drops more feet each decade.</p><p>This matters if your home gets its water from a private well of its own. If you pay a city or water company for your water, a falling water table will rarely reach your tap.</p><p>The water table is the top of the water soaked into the ground below you, and a household well only works while it reaches below that level. This website, ${site.name}, follows one long-running government monitoring well in each of ${fmt(withWell.length)} US counties and works out whether the water there has been getting deeper or shallower. Lining those counties up by how many people live in them gives the picture below.</p>`,
          },
          {
            h2: 'County by county, sorted by population',
            html: `${table}<p>"Share dropping" means the water at that county's monitoring well has been getting further from the surface by more than ${STABLE_BAND_FT_PER_DECADE} feet per decade. "Steady" means it moved less than that either way, and "rising" means it has come closer to the surface. "Typical drop" is the middle value among only the dropping counties in that row: half drop faster, half slower.</p><p>Counties of ${most.label} have the highest share dropping, at ${most.dropPct}%. Counties of ${least.label} have the lowest, at ${least.dropPct}%. So a mid-sized metro county is less likely to be losing groundwater than a farm county with a few thousand households.</p><p>The last column runs the other way. In counties of ${small.label}, a dropping water table typically falls ${one(small.medDrop)} feet per decade. In counties of ${huge.label}, it is ${one(huge.medDrop)} feet per decade, more than twice as fast.</p>`,
          },
          {
            h2: 'Why small counties drop more often',
            html: `<p>Population is not what pulls most groundwater out of the ground. In much of the country, farm irrigation does. The U.S. Geological Survey (USGS, the federal agency that measures the country's water) reports that irrigation is one of the largest uses of groundwater nationally, and irrigated farmland is mostly in counties with few residents. A county of 15,000 people sitting on top of thousands of irrigated acres can pump far more water than a suburb of 300,000 people.</p><p>Many large metro areas have also moved partly off local wells. Cities often pipe in river or reservoir water, or are under state limits on how much groundwater they can pump, and the monitoring wells there can hold steady or even recover as a result.</p><p>This site cannot tell you which of those is happening in a given county. Its data covers water levels, not who is pumping. If you want to know what is drawing your local water down, your state's water agency or geological survey is the place to ask.</p>`,
          },
          {
            h2: 'The biggest counties, one by one',
            html: `<p>${fmt(big.length)} counties with over a million residents have a long-term monitoring well. ${bigDrop.length} of them are dropping, ${bigStable} are stable and ${bigRise.length} are rising.</p><p>The dropping ones, fastest first:</p><ul>${bigDrop.map((x) => `<li>${bigNote(x)}</li>`).join('')}</ul><p>A few of those deserve care. A county with fewer than about 20 readings, or whose latest reading is more than five years old, rests on a thinner record than the rest, and its page says so on the first screen. Underground water is not one big pool. It sits in separate layers of sand, gravel and rock at different depths, and in a huge county the one monitoring well may draw from a different layer than the household wells near you, so your own well's level can be quite different. That is why the last step below is your own well's record.</p>${bigRise.length ? `<p>On the other side, these have water that has been coming closer to the surface:</p><ul>${bigRise.map((x) => `<li>${bigNote(x)}</li>`).join('')}</ul>` : ''}`,
          },
          {
            h2: 'Where the very fastest drops are',
            html: `<p>The top of the list belongs mostly to small places. Of the 15 counties dropping fastest, ${fastSmall} have fewer than 100,000 residents. Here are the five fastest: ${fastest
              .slice(0, 5)
              .map((x) => `${link(x)}, population ${fmt(x.pop)}, ${one(x.s.trendFtPerDecade)} feet per decade`)
              .join('; ')}.</p><p>Very large numbers at a single well are worth checking before you act on them. A well near a quarry, a big irrigation system or a town supply well can fall much faster than the ground around it. The ${guideLink('fastest-moving-counties', 'fastest-moving counties guide')} goes through how to check whether a big number can be trusted.</p>`,
          },
          {
            h2: 'How many people this touches',
            html: `<p>About ${fmt(popDrop / 1e6)} million people live in a county whose monitoring well is dropping. Another ${fmt(popNone / 1e6)} million live in counties with no long-term monitoring well at all, so nobody can say from public records which way their water is going (the ${guideLink('no-data-and-artesian-readings', 'no-data guide')} explains what to do there).</p><p>Most of those people are on city water and will never notice. The numbers matter to the roughly 43 million Americans, about 15% of the population, who drink from a private well of their own, according to the USGS. For them, a falling water table means a pump that sits closer and closer to the water line.</p>`,
          },
          {
            h2: 'What to do with this',
            html: `<p>Do not read much into your county's size. A busy metro and a quiet farm county can both be dropping, and your own well can behave differently from the county's monitoring well either way. ${pageLink('', 'Look up your county')} to see its own trend, the date of its latest reading and how many readings it rests on. Then compare that with your well's driller's log (the report the company that drilled your well filed with the state). Most states let you search these free: search for your state's name plus "well log search", which usually turns up a page run by the state's water, geology or natural resources department. The ${guideLink('well-pump-risk', 'well-pump guide')} shows how to work out how much water is left above your pump.</p><p>All figures here come from the USGS National Water Information System and the National Ground-Water Monitoring Network, both free and public, and county populations from the U.S. Census Bureau. How the trend is drawn is in the ${guideLink('methodology', 'methodology guide')}.</p>`,
          },
        ];
      })(),
    },
    {
      slug: 'dry-summer-or-long-decline',
      title: `Is It a Dry Summer or a Long Decline? How to Tell From Your County's Water Level`,
      description: `Why a well can sputter in a dry August even where the water table is holding steady, how long the government records behind each county go back, and how to tell a bad season from water that is really leaving.`,
      // [R3][R10][R21][R29] Answers the visitor's fourth question in
      // visitor-job.md ("is it a dry season or a long decline?"). Every figure
      // is computed from the same county rows the pages use.
      blocks: (() => {
        const fmt = (n) => Math.round(n).toLocaleString('en-US');
        const andList = (xs) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
        const link = (x) => pageLink(x.r.slug, `${x.s.county}, ${x.s.state}`);
        const withWell = rows.filter((r) => hasQualifyingWell(r) && r.trend_ft_per_decade !== '')
          .map((r) => ({ r, s: summaryBySlug.get(r.slug), span: Number(r.span_years), n: Number(r.n_measurements) }));
        const year = (d) => Number(String(d).slice(0, 4));
        const nowYear = Math.max(...withWell.map((x) => year(x.r.last_date)));
        const spans = withWell.map((x) => x.span);
        const medSpan = median(spans);
        const spanBand = (lo, hi) => spans.filter((v) => v >= lo && v < hi).length;
        const perYear = withWell.map((x) => x.n / x.span);
        const medPerYear = median(perYear);
        const lessThanYearly = perYear.filter((v) => v < 1).length;
        const seasonal = perYear.filter((v) => v >= 4).length;
        const monthly = perYear.filter((v) => v >= 12).length;
        const before1950 = withWell.filter((x) => year(x.r.first_date) < 1950).length;
        const oldest = withWell.reduce((a, b) => (year(b.r.first_date) < year(a.r.first_date) ? b : a));
        const readThisYear = withWell.filter((x) => year(x.r.last_date) === nowYear).length;
        const stale = withWell.filter((x) => nowYear - year(x.r.last_date) > 5).length;
        const dropping = withWell.filter((x) => x.r.direction === 'declining')
          .map((x) => ({ ...x, total: (x.s.trendFtPerDecade * x.span) / 10 }));
        const totalAtLeast = (f) => dropping.filter((x) => x.total >= f).length;
        const medTotal = median(dropping.map((x) => x.total));
        const steady = withWell.filter((x) => x.r.direction === 'stable').length;
        const ranked = [...dropping].sort((a, b) => b.total - a.total);
        const biggest = ranked.filter((x) => x.n >= 20).slice(0, 6);
        const thinTop = ranked.slice(0, 6).filter((x) => x.n < 20);
        const bigLine = (x) => `<li>${link(x)}: about ${fmt(x.total)} feet deeper over ${fmt(x.span)} years of readings (${fmt(x.n)} readings in all)</li>`;
        return [
          {
            h2: 'The short answer',
            html: `<p>One dry summer can make a well sputter, but it does not change the long-term trend shown on ${site.name}. This website follows one government monitoring well in each of ${fmt(withWell.length)} US counties and draws each county's trend from every reading ever taken at that well, and the typical well here has been measured for ${fmt(medSpan)} years. A single low reading in August is one dot among many.</p><p>So if your county's page says the water is steady and your well is struggling in a drought, the likely story is a bad season, and the water should come back up once rain and snow return. If the page says the water has been getting deeper for decades, the trouble is less likely to go away on its own. ${pageLink('', 'Look up your county')} first. The rest of this page explains how to read what you find.</p>`,
          },
          {
            h2: 'Why water levels go up and down every year',
            html: `<p>The water table is the top of the water soaked into the ground below you. A household well only works while its pump sits below that line. In most of the country the line moves with the seasons. Spring rain and melting snow soak in and lift it. Through summer, plants drink much of the rain before it reaches the water, people pump more for lawns and crops, and the line sinks. Then autumn and winter refill it.</p><p>State advice to well owners says the same thing; Tennessee's drought guidance, for one, notes that levels normally fall in dry months and recover in wet ones. A shallow well is hit hardest, because it has only a few feet of water above the pump to spare. That is why neighbors' wells can all start to struggle in the same dry August and then all recover by spring.</p><p>A long decline is different. The yearly ups and downs still happen, but each year's low point is a little lower than the last, because more water leaves the ground than rain puts back. That usually takes heavy pumping from a deep layer of rock or sand that refills slowly, over many years.</p>`,
          },
          {
            h2: 'How far back the records go',
            html: `<p>Every trend on this site rests on a long record, which is what lets it ignore one dry season. Of the ${fmt(withWell.length)} counties with a long-running government monitoring well, this is how many years of readings their well has:</p><ul><li>Under 20 years: ${fmt(spanBand(0, 20))} counties</li><li>20 to 40 years: ${fmt(spanBand(20, 40))}</li><li>40 to 60 years: ${fmt(spanBand(40, 60))}</li><li>60 years or more: ${fmt(spanBand(60, Infinity))}</li></ul><p>${fmt(before1950)} of these wells were first measured before 1950. The oldest record on the site starts in ${year(oldest.r.first_date)}, at the well used for ${link(oldest)}. A record that long has been through many droughts and many wet years, and the trend line runs through all of them.</p><p>Recent readings matter too. ${fmt(readThisYear)} of these wells have already been read this year, in ${nowYear}. ${fmt(stale)} have not been read in more than five years, and their county pages say so on the first screen, because a drought that started after the last reading would not show up at all.</p>`,
          },
          {
            h2: 'Some wells are read often enough to show the seasons, some are not',
            html: `<p>The typical well here is read about ${fmt(medPerYear)} times a year, but that varies a lot:</p><ul><li>${fmt(lessThanYearly)} wells average less than one reading a year. Their record is long but patchy, so it shows which way the water level is slowly heading but cannot show the summer dip.</li><li>${fmt(seasonal)} wells are read four or more times a year, enough to catch the seasonal low and high.</li><li>${fmt(monthly)} of those are read at least once a month, often by an automatic sensor left in the well.</li></ul><p>This matters when you compare the county page with your own well. If your county's well is read once a year, always in spring, its latest depth may look better than what your well shows in late summer. Each county page lists the date of its latest reading, so check which season it came from. A reading taken in a wet April and a reading taken in a dry September at the same well can differ by several feet without anything being wrong.</p>`,
          },
          {
            h2: 'What a long decline adds up to',
            html: `<p>A few feet per decade sounds small. Over a long record it adds up. Taking each dropping county's average pace and multiplying it by the length of its record gives a rough total of how much deeper the water stands now than when measuring began:</p><ul><li>${fmt(dropping.length)} counties have water that is getting deeper.</li><li>The typical one is about ${fmt(medTotal)} feet deeper than at its first reading.</li><li>${fmt(totalAtLeast(25))} are 25 feet or more deeper, ${fmt(totalAtLeast(50))} are 50 feet or more deeper, and ${fmt(totalAtLeast(100))} are 100 feet or more deeper.</li></ul><p>No dry summer does that. These are the largest totals among wells with at least 20 readings:</p><ul>${biggest.map(bigLine).join('')}</ul><p>${thinTop.length ? `${andList(thinTop.map((x) => `${link(x)} (${fmt(x.n)} readings)`))} would also rank near the top, but with so few readings over so many years the total could be well off, so ${thinTop.length === 1 ? 'it is' : 'they are'} left out of this list. ` : ''}The totals are rough because water levels do not fall at an even pace. Some dropped fast decades ago and have since levelled off, and some only started falling recently. The county page's chart shows which. For comparison, ${fmt(steady)} counties are steady, meaning their water has moved less than ${STABLE_BAND_FT_PER_DECADE} feet per decade either way across the whole record.</p>`,
          },
          {
            h2: 'Four signs it is a bad season, not a long decline',
            html: `<ul><li>Your county page says the water is steady or rising.</li><li>The trouble started during a drought, and other wells nearby started struggling at the same time.</li><li>It comes and goes: the well is fine in spring and weak in late summer.</li><li>Your well is shallow. Your driller's log (the report the company that drilled your well filed with the state) shows how deep the well goes. Most states let you search these free: search for your state's name plus "well log search", which usually finds a page run by the state's water, geology or natural resources department. If the pump sits only a little below where the water stood, there is little to spare in a dry spell.</li></ul><p>If all four fit, the usual fixes are small ones: spread out laundry and watering, fix leaks, and hold off on filling a pool until the rain comes back.</p>`,
          },
          {
            h2: 'Signs the water may be leaving for good',
            html: `<ul><li>Your county page says the water has been getting deeper, especially at several feet per decade or more.</li><li>The well got weaker even through wet years.</li><li>Your driller's log shows the water stood much higher when the well was drilled than it does now. A licensed well contractor can measure today's level for you, or you can measure it yourself with a steel tape or an electric sounder after leaving the pump off for about two hours, the method that university well-owner guides describe (Oregon State University's and the University of Arizona's among them).</li></ul><p>In that case the water is unlikely to recover by itself. Before you spend money, rule out a worn pump or a leak, which state well-owner guidance (South Carolina's and Tennessee's, for example) puts first. Then the options run from cheapest to most expensive: lowering the pump, cleaning the well, deepening it, or drilling a new one. The ${guideLink('well-pump-risk', 'well-pump guide')} shows how to work out how much water is left above your pump, and the ${guideLink('fastest-moving-counties', 'fastest-moving counties guide')} covers the places where the water is falling quickest.</p>`,
          },
          {
            h2: 'Where these numbers come from',
            html: `<p>Every figure on this page comes from the U.S. Geological Survey (USGS), the federal science agency that tracks the country's water, through its National Water Information System and the National Ground-Water Monitoring Network. Both are free and public. Which wells count, and how each trend line is drawn, is in the ${guideLink('methodology', 'methodology guide')}.</p>`,
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
