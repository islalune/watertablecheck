// Generates a 1200x630 social card PNG per page. Ported from PanelFit's
// scripts/og-images.js (see that file's header for why PNG, not SVG, and
// why this is cached by content hash).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { summarizeCounty } from '../functions/groundwater-model.js';

const OUT = 'public/og';
fs.mkdirSync(OUT, { recursive: true });

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

function slugify(s) {
  return s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function loadCounties() {
  const csv = fs.readFileSync('src/data/counties.csv', 'utf8').trim();
  const [header, ...lines] = csv.split('\n');
  const cols = splitCsvLine(header);
  const seen = new Map();
  return lines.map((line) => {
    const cells = splitCsvLine(line);
    const raw = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    let slug = slugify(`${raw.county}-${raw.state}`);
    if (seen.has(slug)) slug = `${slug}-${raw.fips.slice(-4)}`;
    seen.set(slug, true);
    return { ...raw, slug };
  });
}

const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ft = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');

/** Crude but adequate wrap: Helvetica bold averages ~0.55em per char. */
function wrap(text, size, maxWidth) {
  const perChar = size * 0.55;
  const max = Math.floor(maxWidth / perChar);
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line) { line = w; continue; }
    if ((line + ' ' + w).length <= max) line += ' ' + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

function card({ title, subtitle, stats = [] }) {
  let size = 72;
  let lines = wrap(title, size, 1040);
  while (lines.length > 2 && size > 40) { size -= 6; lines = wrap(title, size, 1040); }
  lines = lines.slice(0, 2);

  const titleY = stats.length ? 235 : 300;
  const titleSvg = lines.map((l, i) =>
    `<text x="80" y="${titleY + i * (size + 12)}" font-family="${FONT}" font-size="${size}" font-weight="800" fill="#16212c">${esc(l)}</text>`
  ).join('');
  const subY = titleY + lines.length * (size + 12) + 14;

  const tiles = stats.map((s, i) => {
    const x = 80 + i * 350;
    return `<rect x="${x}" y="392" width="320" height="148" rx="16" fill="#eaf0fb"/>
<text x="${x + 30}" y="462" font-family="${FONT}" font-size="46" font-weight="800" fill="#16212c">${esc(s.n)}</text>
<text x="${x + 30}" y="504" font-family="${FONT}" font-size="22" fill="#5b6b7b">${esc(s.l.toUpperCase())}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#f7f9fc"/>
<rect x="0" y="0" width="1200" height="10" fill="hsl(222 55% 38%)"/>
<circle cx="86" cy="78" r="17" fill="hsl(222 55% 38%)"/>
<text x="118" y="90" font-family="${FONT}" font-size="34" font-weight="700" fill="#16212c">WaterTableCheck</text>
${titleSvg}
${subtitle ? `<text x="80" y="${subY}" font-family="${FONT}" font-size="30" fill="#5b6b7b">${esc(subtitle)}</text>` : ''}
${tiles}
<text x="80" y="592" font-family="${FONT}" font-size="27" fill="hsl(222 55% 30%)">watertablecheck.com</text>
</svg>`;
}

let made = 0, cached = 0;
function emit(name, svg) {
  const png = path.join(OUT, name + '.png');
  const hash = crypto.createHash('sha1').update(svg).digest('hex').slice(0, 12);
  const stamp = path.join(OUT, '.' + name + '.hash');
  if (fs.existsSync(png) && fs.existsSync(stamp) &&
      fs.readFileSync(stamp, 'utf8') === hash) { cached++; return; }
  const tmp = path.join(OUT, name + '.svg');
  fs.writeFileSync(tmp, svg);
  execFileSync('rsvg-convert', ['-w', '1200', '-h', '630', '-o', png, tmp]);
  fs.unlinkSync(tmp);
  fs.writeFileSync(stamp, hash);
  made++;
}

// default / homepage
emit('default', card({
  title: 'Is the water table dropping where I live?',
  subtitle: 'Depth-to-water trends from real USGS monitoring wells, county by county',
}));

// counties
const rows = loadCounties();
for (const row of rows) {
  const s = summarizeCounty(row);
  const title = `${row.county}, ${row.state}: is the water table dropping?`;
  if (!s.hasQualifyingWell) {
    emit(row.slug, card({
      title,
      subtitle: 'No long-term USGS monitoring well covers this county yet',
    }));
    continue;
  }
  const direction = s.trendFtPerDecade > 0 ? 'Declining' : s.trendFtPerDecade < 0 ? 'Rising' : 'Stable';
  emit(row.slug, card({
    title,
    subtitle: 'Real USGS monitoring-well data · county by county',
    stats: [
      { n: `${ft(Math.abs(s.trendFtPerDecade))} ft`, l: 'Per decade' },
      { n: direction, l: 'Direction' },
      { n: `${s.spanYears ?? '—'} yr`, l: 'Well record' },
    ],
  }));
}

// guides - titles come from the built HTML so they cannot drift
const guideDir = 'public/guides';
if (fs.existsSync(guideDir)) {
  for (const f of fs.readdirSync(guideDir)) {
    if (!f.endsWith('.html')) continue;
    const slug = f.slice(0, -5);
    const html = fs.readFileSync(path.join(guideDir, f), 'utf8');
    const h1 = (html.match(/<h1>([^<]*)<\/h1>/) || [])[1] || slug;
    emit('guide-' + slug, card({
      title: h1.replace(/&amp;/g, '&').replace(/&#39;/g, "'"),
      subtitle: 'WaterTableCheck guide · plain answers, real numbers',
    }));
  }
}

console.log(`og images: ${made} generated, ${cached} unchanged`);
