// Build the per-county groundwater-level-trend dataset every county page is
// generated from.
//
//   node scripts/fetch-groundwater-levels.js
//
// Three real sources, no API key needed:
//
//   1. USGS Water Data APIs (api.waterdata.usgs.gov/ogcapi/v0), the
//      replacement for the legacy `gwlevels`/`waterservices` endpoints that
//      were decommissioned Nov 2025-Jun 2026 (confirmed live: the old
//      waterservices.usgs.gov/nwis/gwlevels/ URL now 301s to USGS's own
//      decommission notice). `field-measurements-metadata` gives every
//      (well, parameter) time-series' begin/end dates WITHOUT downloading
//      every reading, so wells can be screened for a long-enough record
//      before the expensive per-well fetch. `monitoring-locations` resolves
//      a well to its county FIPS. `field-measurements` gives the actual
//      depth-to-water readings for the wells that pass the screen.
//      Parameter 72019 = "Water level, depth LSD" (depth to water, feet
//      below land surface) - confirmed against parameter-codes/items.
//   2. Census 2025 Gazetteer, counties national -> FIPS, lat/lon, land area,
//      the same source and join key (5-digit FIPS) USGS's own state_code +
//      county_code use, so this is a numeric join, not radon's name-matching
//      one.
//   3. Census Population Estimates co-est2024-alldata -> county population.
//
// Scope note, and the reason many counties will have no data: this is NOT
// a live readout. It is a linear trend fit to one representative well's
// historical depth-to-water measurements (candidates.json's own caution:
// "monitoring-well density is genuinely uneven, so many counties will need
// honest 'insufficient data' pages rather than padded coverage" - confirmed
// true by this run's own numbers, see counties-sources.json). A well
// qualifies only with >=15 years of span AND a measurement within the last
// 10 years, so the trend reflects a real multi-decade record still being
// tracked, not a single old reading. One well stands in for a whole county -
// a real simplification, not hidden: the model/template layer must say so.
//
// Every network call is cached under src/data/_cache/ and reused, so
// re-running is free and this script is safe to stop and resume - the
// metadata pull alone is ~900k rows over ~19 pages and the per-well fetch
// that follows is the slow part.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'src', 'data');
const CACHE = path.join(DATA, '_cache');
const FMM_CACHE = path.join(CACHE, 'fmm');
const WELL_CACHE = path.join(CACHE, 'wells');
const LOC_CACHE = path.join(CACHE, 'locations');
for (const d of [CACHE, FMM_CACHE, WELL_CACHE, LOC_CACHE]) fs.mkdirSync(d, { recursive: true });

const API = 'https://api.waterdata.usgs.gov/ogcapi/v0';
const PARAM = '72019'; // Water level, depth LSD (ft below land surface)
const MIN_SPAN_YEARS = 15;
const RECENT_CUTOFF = new Date(Date.now() - 10 * 365.25 * 86400 * 1000); // must have measured within 10y
const MIN_MEASUREMENTS = 6;

const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/counties/totals/co-est2024-alldata.csv';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thrown when the API's hourly quota (1000 req/hr/IP, confirmed via
 * X-RateLimit-* headers - there is no key, unauthenticated is the norm
 * for every source in this factory) is hit or nearly hit. Caught at the
 * top level: everything so far is already cached, so the script just
 * stops cleanly rather than blocking the whole run through a
 * multi-hundred-second Retry-After sleep. Next run resumes from cache. */
class RateLimited extends Error {}

/** GET with retry/backoff. 429 and 5xx are retried once briefly (transient
 * blips); a 429 that repeats means the hourly quota is actually exhausted,
 * so it gives up fast instead of sleeping out a ~15min Retry-After. */
async function getWithRetry(url, { tries = 2, headers = {} } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    let res;
    try {
      res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'watertablecheck-fetch/1.0', ...headers } });
    } catch (err) {
      if (attempt === tries) throw err;
      await sleep(1000 * attempt);
      continue;
    }
    if (res.status === 429) {
      if (attempt < tries) { await sleep(2000); continue; }
      const retryAfter = Number(res.headers.get('retry-after')) || null;
      throw new RateLimited(`hourly quota exhausted (retry-after ${retryAfter}s)`);
    }
    if (res.status >= 500) {
      if (attempt === tries) throw new Error(`HTTP ${res.status} for ${url}`);
      await sleep(1500 * attempt);
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { fatal: true, status: res.status });
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    if (Number.isFinite(remaining) && remaining < 15) {
      throw new RateLimited(`only ${remaining} requests left in the hourly quota - stopping with headroom`);
    }
    return res;
  }
}

/** Fetch a binary URL to a cache file, reused if already present. */
async function cachedBinary(url, file) {
  const dest = path.join(CACHE, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const res = await getWithRetry(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  fetched ${file}  ${(buf.length / 1e6).toFixed(2)} MB`);
  return dest;
}

/** Minimal ZIP reader (no `unzip` binary on this VM) - single-file archive, STORED or DEFLATE. */
function unzipSingleFile(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip (no EOCD record)');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const sig = buf.readUInt32LE(cdOffset);
  if (sig !== 0x02014b50) throw new Error('central directory signature mismatch');
  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const localOffset = buf.readUInt32LE(cdOffset + 42);
  const lfhNameLen = buf.readUInt16LE(localOffset + 26);
  const lfhExtraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen;
  const compData = buf.subarray(dataStart, dataStart + compSize);
  return method === 0 ? compData : method === 8 ? zlib.inflateRawSync(compData) : (() => { throw new Error(`unsupported zip method ${method}`); })();
}

function splitCsv(line) {
  const out = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);

// --- 1. County base list: Census Gazetteer + population, keyed on FIPS ---
async function loadCountyBase() {
  const gazZip = await cachedBinary(GAZ, 'census-2025-gaz-counties-national.zip');
  const gazTxt = unzipSingleFile(fs.readFileSync(gazZip)).toString('utf8');
  const counties = new Map();
  for (const line of gazTxt.split('\n').slice(1)) {
    const f = line.split('|').map((s) => s.trim());
    if (f.length < 11 || !f[1]) continue;
    const [usps, geoid, , , name, , , alandSqMi, , lat, lon] = f;
    counties.set(geoid, {
      fips: geoid, county: name, state: usps,
      lat: Number(lat), lon: Number(lon), land_sq_mi: Number(alandSqMi) || 0,
    });
  }
  console.log(`Gazetteer: ${counties.size} counties`);

  const popCsv = await cachedBinary(POP, 'census-co-est2024-alldata.csv');
  const popLines = fs.readFileSync(popCsv, 'latin1').split('\n');
  const head = splitCsv(popLines[0]);
  const col = (n) => head.indexOf(n);
  const [iSum, iState, iCounty, iPop, iStName] = ['SUMLEV', 'STATE', 'COUNTY', 'POPESTIMATE2024', 'STNAME'].map(col);
  let matched = 0;
  for (const line of popLines.slice(1)) {
    if (!line.trim()) continue;
    const f = splitCsv(line);
    if (f[iSum] !== '050') continue;
    const fips = f[iState] + f[iCounty];
    const c = counties.get(fips);
    const n = Number(f[iPop]);
    if (c && Number.isFinite(n)) { c.population = n; c.state_name = f[iStName]; matched++; }
  }
  console.log(`Population matched: ${matched}/${counties.size}`);
  return counties;
}

// --- 2. field-measurements-metadata: every (well, param) series' span -----
async function loadCandidateSeries() {
  const summaryFile = path.join(FMM_CACHE, '_candidates.json');
  if (fs.existsSync(summaryFile)) {
    const cached = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    console.log(`Candidate series (cached): ${cached.length}`);
    return cached;
  }

  let url = `${API}/collections/field-measurements-metadata/items?f=json&parameter_code=${PARAM}&limit=50000`;
  let page = 0;
  const candidates = [];
  let totalSeries = 0;
  while (url) {
    page++;
    const pageFile = path.join(FMM_CACHE, `page-${String(page).padStart(2, '0')}.json`);
    let d;
    if (fs.existsSync(pageFile)) {
      d = JSON.parse(fs.readFileSync(pageFile, 'utf8'));
    } else {
      const res = await getWithRetry(url);
      const body = await res.text();
      d = JSON.parse(body);
      fs.writeFileSync(pageFile, body);
      await sleep(150);
    }
    totalSeries += d.features.length;
    for (const f of d.features) {
      const p = f.properties;
      if (p.reading_type !== 'ReferencePrimary') continue;
      const begin = p.begin ? new Date(p.begin) : null;
      const end = p.end ? new Date(p.end) : null;
      if (!begin || !end || Number.isNaN(+begin) || Number.isNaN(+end)) continue;
      const spanYears = (end - begin) / (365.25 * 86400 * 1000);
      if (spanYears < MIN_SPAN_YEARS) continue;
      if (end < RECENT_CUTOFF) continue;
      candidates.push({ monitoring_location_id: p.monitoring_location_id, begin: p.begin, end: p.end, spanYears });
    }
    console.log(`  fmm page ${page}: ${d.features.length} rows (total ${totalSeries}), candidates so far ${candidates.length}`);
    const next = (d.links || []).find((l) => l.rel === 'next');
    url = next ? next.href : null;
  }
  fs.writeFileSync(summaryFile, JSON.stringify(candidates));
  console.log(`Series scanned: ${totalSeries}. Candidates (>=${MIN_SPAN_YEARS}y span, measured since ${RECENT_CUTOFF.toISOString().slice(0, 10)}): ${candidates.length}`);
  return candidates;
}

// --- 3. Resolve each candidate well to its county via monitoring-locations
async function resolveCounties(candidates) {
  const resolvedFile = path.join(LOC_CACHE, '_resolved.json');
  if (fs.existsSync(resolvedFile)) {
    const cached = JSON.parse(fs.readFileSync(resolvedFile, 'utf8'));
    console.log(`Locations resolved (cached): ${Object.keys(cached).length}`);
    return cached;
  }
  const ids = [...new Set(candidates.map((c) => c.monitoring_location_id))];
  const CHUNK = 100;
  const resolved = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const chunkFile = path.join(LOC_CACHE, `chunk-${String(i / CHUNK).padStart(4, '0')}.json`);
    let d;
    if (fs.existsSync(chunkFile)) {
      d = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));
    } else {
      const url = `${API}/collections/monitoring-locations/items?f=json&id=${chunk.map(encodeURIComponent).join(',')}&limit=${CHUNK}`;
      const res = await getWithRetry(url);
      const body = await res.text();
      d = JSON.parse(body);
      fs.writeFileSync(chunkFile, body);
      await sleep(150);
    }
    for (const f of d.features) {
      const p = f.properties;
      if (p.site_type_code !== 'GW') continue;
      if (!p.state_code || !p.county_code) continue;
      resolved[p.id] = { fips: p.state_code + p.county_code, name: p.monitoring_location_name, altitude: p.altitude };
    }
    if ((i / CHUNK) % 10 === 0) console.log(`  resolved ${Object.keys(resolved).length}/${ids.length} wells (chunk ${i / CHUNK + 1}/${Math.ceil(ids.length / CHUNK)})`);
  }
  fs.writeFileSync(resolvedFile, JSON.stringify(resolved));
  console.log(`Locations resolved: ${Object.keys(resolved).length}/${ids.length}`);
  return resolved;
}

// --- 4. Pick one representative well per county (longest span, then most recent)
function pickRepresentatives(candidates, resolved) {
  const byCounty = new Map();
  for (const c of candidates) {
    const loc = resolved[c.monitoring_location_id];
    if (!loc) continue;
    const cur = byCounty.get(loc.fips);
    const scored = { ...c, fips: loc.fips, name: loc.name };
    if (!cur || scored.spanYears > cur.spanYears || (scored.spanYears === cur.spanYears && scored.end > cur.end)) {
      byCounty.set(loc.fips, scored);
    }
  }
  console.log(`Counties with a qualifying well: ${byCounty.size}`);
  return byCounty;
}

/** Ordinary least-squares slope of value on time (years), ft/year. Positive = deepening = declining. */
function linearTrendFtPerYear(points) {
  const t0 = points[0].t;
  const xs = points.map((p) => p.t - t0);
  const ys = points.map((p) => p.v);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2; }
  return den === 0 ? 0 : num / den;
}

// --- 5. Fetch each representative well's full measurement history ---------
async function fetchWellHistory(id) {
  const file = path.join(WELL_CACHE, `${id.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  let rows;
  if (fs.existsSync(file)) {
    rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    const url = `${API}/collections/field-measurements/items?f=json&monitoring_location_id=${encodeURIComponent(id)}&parameter_code=${PARAM}&reading_type=ReferencePrimary&limit=5000`;
    const res = await getWithRetry(url);
    const body = await res.text();
    const d = JSON.parse(body);
    rows = d.features.map((f) => ({ t: f.properties.time, v: Number(f.properties.value) }));
    fs.writeFileSync(file, JSON.stringify(rows));
    await sleep(120);
  }
  return rows
    .filter((r) => r.t && Number.isFinite(r.v))
    .map((r) => ({ t: new Date(r.t), v: r.v }))
    .filter((r) => !Number.isNaN(+r.t))
    .sort((a, b) => a.t - b.t);
}

async function main() {
  console.log('Sources:');
  const counties = await loadCountyBase();
  const candidates = await loadCandidateSeries();
  const resolved = await resolveCounties(candidates);
  const reps = pickRepresentatives(candidates, resolved);

  console.log('\nFetching per-well histories and computing trends...');
  let done = 0, insufficient = 0, failed = 0, rateLimited = false;
  const wellData = new Map(); // fips -> computed row
  const repEntries = [...reps.entries()];
  for (const [fips, rep] of repEntries) {
    let hist;
    try {
      hist = await fetchWellHistory(rep.monitoring_location_id);
    } catch (err) {
      if (err instanceof RateLimited) {
        console.log(`\nSTOPPING (not failing): ${err.message}. ${done} wells done, ${repEntries.length - done - insufficient - failed} not yet attempted this run - every fetch so far is cached, so the next run resumes here and re-fetches nothing already done.`);
        rateLimited = true;
        break;
      }
      failed++;
      console.log(`  FAILED ${rep.monitoring_location_id} (${fips}): ${err.message}`);
      continue;
    }
    if (hist.length < MIN_MEASUREMENTS) { insufficient++; continue; }
    const points = hist.map((h) => ({ t: h.t.getTime() / (365.25 * 86400 * 1000), v: h.v }));
    const ftPerYear = linearTrendFtPerYear(points);
    const first = hist[0], last = hist[hist.length - 1];
    wellData.set(fips, {
      well_id: rep.monitoring_location_id,
      well_name: rep.name || '',
      n_measurements: hist.length,
      first_date: first.t.toISOString().slice(0, 10),
      last_date: last.t.toISOString().slice(0, 10),
      span_years: +((last.t - first.t) / (365.25 * 86400 * 1000)).toFixed(1),
      current_depth_ft: +last.v.toFixed(1),
      trend_ft_per_decade: +(ftPerYear * 10).toFixed(2),
      decline_10yr_ft: +(ftPerYear * 10).toFixed(1),
      decline_30yr_ft: +(ftPerYear * 30).toFixed(1),
      direction: ftPerYear > 0.05 ? 'declining' : ftPerYear < -0.05 ? 'rising' : 'stable',
    });
    done++;
    if (done % 200 === 0) console.log(`  ${done}/${repEntries.length} wells processed (${insufficient} insufficient, ${failed} failed)`);
  }
  console.log(`Wells processed: ${done} usable, ${insufficient} had <${MIN_MEASUREMENTS} readings after fetch, ${failed} failed`);

  // --- 6. Join to every US county, honest gap where there's no data -------
  const rows = [];
  for (const [fips, c] of counties) {
    const w = wellData.get(fips);
    rows.push({
      fips, county: c.county, state: c.state, state_name: c.state_name || '',
      lat: Number.isFinite(c.lat) ? +c.lat.toFixed(4) : '', lon: Number.isFinite(c.lon) ? +c.lon.toFixed(4) : '',
      land_sq_mi: c.land_sq_mi, population: c.population ?? '',
      has_data: w ? 1 : 0,
      well_id: w?.well_id ?? '', well_name: w?.well_name ?? '',
      n_measurements: w?.n_measurements ?? '', first_date: w?.first_date ?? '', last_date: w?.last_date ?? '',
      span_years: w?.span_years ?? '', current_depth_ft: w?.current_depth_ft ?? '',
      trend_ft_per_decade: w?.trend_ft_per_decade ?? '', decline_10yr_ft: w?.decline_10yr_ft ?? '',
      decline_30yr_ft: w?.decline_30yr_ft ?? '', direction: w?.direction ?? '',
    });
  }
  rows.sort((a, b) => (b.population || 0) - (a.population || 0));

  const cols = Object.keys(rows[0]);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'counties.csv'),
    [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n');

  const withData = rows.filter((r) => r.has_data).length;
  fs.writeFileSync(path.join(DATA, 'counties-sources.json'), JSON.stringify({
    retrieved: new Date().toISOString(),
    counties: rows.length,
    countiesWithData: withData,
    coveragePct: +((withData / rows.length) * 100).toFixed(1),
    groundwaterLevels: {
      api: `${API}/collections/field-measurements`,
      metadataApi: `${API}/collections/field-measurements-metadata`,
      locationsApi: `${API}/collections/monitoring-locations`,
      parameterCode: PARAM,
      parameterMeaning: 'Water level, depth LSD - depth to water level, feet below land surface (confirmed via parameter-codes/items)',
      gives: 'Individual field-visit depth-to-water readings per well, fit to a simple linear trend (ordinary least squares, ft/year) over the well\'s full qualifying record.',
      note: 'Legacy waterservices.usgs.gov/nwis/gwlevels/ is decommissioned (confirmed: now 301s to USGS\'s own decommission notice); this uses the replacement OGC API at api.waterdata.usgs.gov, live-verified 2026-08-27.',
      qualifyingWellRule: `A well qualifies as a county's representative only with a field-measurements-metadata span >= ${MIN_SPAN_YEARS} years AND a most-recent reading within the last 10 years (not an abandoned well from decades ago), AND >= ${MIN_MEASUREMENTS} usable readings after the full history was actually fetched. ${done} counties nationally have a qualifying well out of ${rows.length} total - this uneven coverage is real, not a bug: candidates.json flagged it in advance ("monitoring-well density is genuinely uneven").`,
      oneWellPerCounty: 'Exactly one representative well (longest qualifying span, ties broken by most recent) stands in for the whole county. This is a real simplification - a single well is not the whole county\'s aquifer - and every page must say so, the same way FloodZoneCheck\'s pages disclose parcel-vs-county granularity.',
      trendMethod: 'Ordinary least-squares linear regression of depth-to-water (ft below land surface) against time (years) across every usable reading in the well\'s qualifying record. Positive slope = getting deeper = water table declining. decline_10yr_ft/decline_30yr_ft are the slope extrapolated forward, not a measured 10/30-year change for wells with a shorter or longer actual record - the model/template layer must present this as a rate-based projection, not a guarantee.',
    },
    gazetteer: { url: GAZ, vintage: '2025', gives: 'county FIPS, name, state, lat/lon, land area' },
    population: { url: POP, vintage: 'POPESTIMATE2024', sumlev: '050 county' },
    joinMethod: 'Numeric FIPS join throughout: USGS state_code (2-digit) + county_code (3-digit) = the same 5-digit FIPS the Census Gazetteer and population files use. No name-matching, unlike RadonZoneCheck\'s EPA-sheet join.',
  }, null, 2) + '\n');

  console.log(`\nWrote src/data/counties.csv - ${rows.length} counties, ${withData} (${((withData / rows.length) * 100).toFixed(1)}%) with a qualifying well`);
  const declining = rows.filter((r) => r.direction === 'declining').length;
  const rising = rows.filter((r) => r.direction === 'rising').length;
  const stable = rows.filter((r) => r.direction === 'stable').length;
  console.log(`  direction split: declining ${declining}, rising ${rising}, stable ${stable}`);

  // Spot-check known Ogallala-aquifer-depletion counties (should show
  // declining) against a known-stable region, so a join bug or placeholder
  // value would be obvious immediately.
  const spot = [
    ['Finney', 'KS'], ['Haskell', 'KS'], ['Stanton', 'KS'], ['Grant', 'KS'], // heavy Ogallala decline, well documented
    ['Pinal', 'AZ'], // Arizona groundwater basin, heavy agricultural draw
    ['Cook', 'IL'], ['Suffolk', 'MA'], // large population, not aquifer-stressed
  ];
  for (const [name, st] of spot) {
    const r = rows.find((x) => x.county.startsWith(name) && x.state === st);
    if (r) console.log(`  spot-check ${r.county}, ${r.state}: has_data=${r.has_data} direction=${r.direction || 'n/a'} trend=${r.trend_ft_per_decade || 'n/a'} ft/decade well=${r.well_id || 'none'} (${r.span_years || 0}y, ${r.n_measurements || 0} readings)`);
    else console.log(`  spot-check ${name}, ${st}: NOT FOUND in county list`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
