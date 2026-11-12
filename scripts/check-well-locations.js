// Checks that each county's monitoring well really sits in that county.
// Pulls the well's own record (state, county, lat/lon) from the free USGS
// monitoring-locations API and compares it with the county it is shown on.
// Writes src/data/well-locations.json. Usage: node scripts/check-well-locations.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'src', 'data');
const API = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items';

function parseCsv(text) {
  const [head, ...lines] = text.trim().split('\n');
  const cols = head.split(',');
  return lines.map((line) => {
    const out = [];
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, out[i]]));
  });
}

function miles(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

async function lookup(id) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(id)}&f=json`);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return j.features?.[0] ?? null;
    } catch (e) {
      await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
    }
  }
  return undefined;
}

const rows = parseCsv(fs.readFileSync(path.join(dataDir, 'counties.csv'), 'utf8'))
  .filter((r) => r.has_data === '1' && r.well_id);

const results = {};
let i = 0;
async function worker() {
  while (i < rows.length) {
    const r = rows[i++];
    const f = await lookup(r.well_id);
    if (f === undefined) { results[r.fips] = { well_id: r.well_id, status: 'lookup-failed' }; continue; }
    if (!f) { results[r.fips] = { well_id: r.well_id, status: 'not-in-usgs-locations' }; continue; }
    const p = f.properties;
    const [lon, lat] = f.geometry?.coordinates ?? [null, null];
    const wellFips = p.state_code && p.county_code ? `${p.state_code}${p.county_code}` : null;
    results[r.fips] = {
      well_id: r.well_id,
      lat, lon,
      well_county_fips: wellFips,
      well_county_name: p.county_name,
      well_state: p.state_name,
      miles_from_county_centre: lat != null ? Math.round(miles(+r.lat, +r.lon, lat, lon) * 10) / 10 : null,
      status: !wellFips ? 'no-county-on-record' : wellFips === r.fips ? 'in-county' : 'other-county',
    };
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

const counts = {};
for (const v of Object.values(results)) counts[v.status] = (counts[v.status] || 0) + 1;
fs.writeFileSync(path.join(dataDir, 'well-locations.json'), JSON.stringify({
  retrieved: new Date().toISOString(),
  source: API,
  counts,
  wells: results,
}, null, 1));
console.log(counts);
for (const [fips, v] of Object.entries(results)) {
  if (v.status === 'other-county') {
    const r = rows.find((x) => x.fips === fips);
    console.log(`${r.county}, ${r.state} (${fips}) -> well in ${v.well_county_name}, ${v.well_state} (${v.well_county_fips}), ${v.miles_from_county_centre} mi`);
  }
}
