// Shared groundwater-trend model. Same role as flood-model.js and
// solar-model.js: the one place that turns a county's representative-well
// reading into the number a page shows, so the generator and any future
// API route cannot disagree about what a county's water table is doing.
//
// Scope note (see src/data/counties-sources.json): USGS/NGWMN monitoring-
// well density is uneven - only 1,449 of 3,222 US counties (45%) have a
// well that qualifies as a long-term representative record (>=15y span, a
// reading within the last 10y, >=6 usable readings). ONE well stands in
// for a whole county's aquifer - a real simplification every page must
// disclose, the same way flood-model discloses parcel-vs-county grain.
// decline_10yr_ft/decline_30yr_ft are the fitted slope extrapolated
// forward, not a measured 10/30-year change for every well - this module
// treats them as a rate-based projection, never a guarantee.

/**
 * The fetch script (scripts/fetch-groundwater-levels.js) decides direction
 * from the OLS slope itself: >0.05 ft/year (0.5 ft/decade) deepening =
 * declining, <-0.05 ft/year = rising, else stable. Repeated here as a
 * constant rather than re-derived, so the model and the dataset can never
 * disagree about where "stable" ends.
 */
export const STABLE_BAND_FT_PER_DECADE = 0.5;

/**
 * Terciles of this dataset's own 494 declining counties (computed
 * 2026-10-28 from src/data/counties.csv) - an empirical split of THIS
 * dataset, not an external depletion-severity standard. No sourced
 * universal threshold for "severe" aquifer decline was found during
 * revenue research, so this model does not invent one.
 */
export const DECLINE_TERCILES_FT_PER_DECADE = { mild: 1.24, moderate: 4.1 };

export const QUALIFYING_SPAN_YEARS = 15;
export const QUALIFYING_RECENCY_YEARS = 10;
export const QUALIFYING_MIN_READINGS = 6;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hasQualifyingWell(row) {
  return row.has_data === '1' || row.has_data === 1;
}

/**
 * The core decision number: which way this county's water table is moving
 * and, if declining, how that compares to other declining counties
 * nationally. "No data" is returned honestly rather than guessed or
 * inherited from a neighboring county - uneven monitoring-well coverage is
 * the single biggest caveat this site carries, and candidates.json flagged
 * it before the dataset was even built.
 */
export function severity(row) {
  if (!hasQualifyingWell(row)) {
    return { tier: 'no-data', label: 'No long-term monitoring well nearby', trendFtPerDecade: null };
  }
  const trend = num(row.trend_ft_per_decade);
  if (trend === null) {
    return { tier: 'no-data', label: 'No long-term monitoring well nearby', trendFtPerDecade: null };
  }
  // Trust row.direction - already decided by the fetch script from the same
  // OLS slope - rather than re-deriving it from trend here. Re-deriving with
  // slightly different comparison operators is exactly how a model and its
  // dataset end up disagreeing at a boundary value.
  if (row.direction === 'stable') {
    return { tier: 'stable', label: 'Stable', trendFtPerDecade: trend };
  }
  if (row.direction === 'rising') {
    return { tier: 'rising', label: 'Rising (getting shallower)', trendFtPerDecade: trend };
  }
  const { mild, moderate } = DECLINE_TERCILES_FT_PER_DECADE;
  if (trend < mild) {
    return { tier: 'declining-mild', label: 'Declining, slower than most declining counties', trendFtPerDecade: trend };
  }
  if (trend < moderate) {
    return { tier: 'declining-moderate', label: 'Declining, a typical pace among declining counties', trendFtPerDecade: trend };
  }
  return { tier: 'declining-severe', label: 'Declining, faster than most declining counties', trendFtPerDecade: trend };
}

/**
 * Whether the well-pump-failure-risk CTA (revenue.md's primary route - AHS/
 * Choice home-warranty well-pump coverage) is the honest framing for this
 * county. A declining water table makes a pump reach further and work
 * harder; a stable or rising one does not, and showing the same CTA there
 * would be the kind of unsupported "your well WILL run dry" framing
 * revenue.md explicitly rules out.
 */
export function pumpRiskRelevant(row) {
  return severity(row).tier.startsWith('declining');
}

/**
 * depth-to-water below land surface, below surface or artesian (water above
 * land surface). A handful of wells (23 of 1,449) read negative - genuinely
 * flowing/artesian conditions, not a data error - and must say so rather
 * than printing a meaningless negative depth.
 */
export function depthDescription(row) {
  const depth = num(row.current_depth_ft);
  if (depth === null) return { depthFt: null, isArtesian: false, text: 'Not reported' };
  if (depth < 0) {
    return { depthFt: depth, isArtesian: true, text: `${Math.abs(depth)} ft above land surface (flowing/artesian)` };
  }
  return { depthFt: depth, isArtesian: false, text: `${depth} ft below land surface` };
}

/**
 * Full per-county summary - the shape a page or API route consumes. Every
 * number a page renders should come from here, not be recomputed inline, so
 * a future API endpoint returns exactly what the static pages show.
 */
export function summarizeCounty(row) {
  const s = severity(row);
  const depth = depthDescription(row);
  return {
    fips: row.fips,
    county: row.county,
    state: row.state,
    stateName: row.state_name,
    population: num(row.population),
    hasQualifyingWell: hasQualifyingWell(row),
    severityTier: s.tier,
    severityLabel: s.label,
    trendFtPerDecade: s.trendFtPerDecade,
    decline10yrFt: num(row.decline_10yr_ft),
    decline30yrFt: num(row.decline_30yr_ft),
    currentDepthFt: depth.depthFt,
    isArtesian: depth.isArtesian,
    depthText: depth.text,
    pumpRiskRelevant: pumpRiskRelevant(row),
    wellId: row.well_id || null,
    wellName: row.well_name || null,
    spanYears: num(row.span_years),
    nMeasurements: num(row.n_measurements),
    firstDate: row.first_date || null,
    lastDate: row.last_date || null,
  };
}

export const SEVERITY_TIERS_ORDERED = [
  'declining-severe', 'declining-moderate', 'declining-mild', 'stable', 'rising', 'no-data',
];
