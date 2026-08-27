# WaterTableCheck — revenue routes

Researched 2026-08-27, before the dataset and template exist, so the answer
shapes what the pages must contain — same order as HeatPumpPayback,
FloodZoneCheck, WildfireRiskCheck, ChargeCostFinder, TapWaterCheck,
WetlandCheck.

**Every number below is sourced.** Where a figure could not be verified for
this specific vertical it is marked unknown, not estimated — a guessed
commission, AOV, or conversion rate is worse than none because the whole
site gets planned around it.

The site: enter an address or county, get a USGS NWIS/NGWMN groundwater-level
trend (a 10/30-year decline rate for the nearest monitoring well), aimed at
well-dependent rural/exurban homeowners asking "is my well going to run dry."
`scout/candidates.json`'s own note is blunt about both halves of the problem:
**"No consumer lookup site found; existing tools are USGS's own
hydrologist-facing dashboards"** (genuine white space) but **"Audience is
narrower... and monitoring-well density is genuinely uneven, so many
counties will need honest 'insufficient data' pages rather than padded
coverage."** The second half turns out to be the whole story financially —
see below.

---

## The honest ceiling — run first, before anything else

`scout/ranked.json` measures this niche's core query family (Google Ads
Keyword Planner, via `scout/volume.js` — real measured data, not a guess) at
**10 searches/month total** — tied with coastal-erosion-rate for the
smallest of every candidate scouted, a fraction of TapWaterCheck's already-
weak 6,200/month, and far below every other sibling site (86,000, 92,000,
61,210, 37,700, 21,600, 14,700, 8,160, 5,190, 2,910, 2,770, 700, 70, 50, 10,
10, 0 are the rest of the ranked pool). Run through `factory/target.js`:

| Model | Rate used (sourced below) | Monthly visits needed | Realistically capturable (top-3, 15% CTR) | Verdict |
|---|---|---|---|---|
| Display ads, low end | $6 RPM | 166,667 | 2 | **NOT reachable — needs 8,333,350% of the whole niche** |
| Display ads, high end | $15 RPM | 66,667 | 2 | **NOT reachable — needs 3,333,350%** |
| Home-warranty lead-gen, AHS ($18/lead, 2% conv) | $0.36/visit | 2,778 | 2 | **NOT reachable — needs 138,900%** |
| Home-warranty lead-gen, Choice/AHS sale ($30/sale, 1% conv) | $0.30/visit | 3,333 | 2 | **NOT reachable — needs 166,650%** |
| Best-case leads anywhere sourced ($100/lead, 2% conv) | $2.00/visit | 500 | 2 | **NOT reachable — needs 25,000%** |
| Water-test-kit affiliate (~$20/sale, 0.5% conv) | $0.10/visit | 10,000 | 2 | **NOT reachable — needs 500,000%** |

**No model gets remotely close, on any assumption stack.** Every sibling
site researched so far that failed to reach $1,000/month (TapWaterCheck at
6,200/month core volume) still fell short by "only" one to two orders of
magnitude. This site's core query family is 620x smaller than
TapWaterCheck's, so the same lead-gen math that left TapWaterCheck at 54%
of capturable traffic in its best case leaves this site needing 25,000% of
capturable traffic in its best case — three to four orders of magnitude
short, not a near-miss.

**Honest ceiling for Olivia: $1,000/month is not reachable on this niche's
measured search volume under any model, and this is the worst result of
every site scouted to date** — worse than TapWaterCheck, worse than
snow-load-roof (700/month), worse than every built sibling. The scout's own
`decision: 0.65` and `rpm: 0.35` scores were already the lowest or
near-lowest in the batch, and the measured Keyword-Planner volume confirms
it rather than contradicting it. Two things could change this that this
research pass cannot resolve: (1) the actual traffic driver for a
per-county static site is long-tail queries beyond the four head terms
Keyword Planner was seeded with (`GenerateKeywordIdeas` does expand beyond
literal input, so 10/month is a real modeled ceiling for this *kind* of
query, not just four exact phrases — this is not a methodology gap, it is
the answer); (2) monitoring-well coverage is uneven per `candidates.json`'s
own caution, meaning many of the ~1,800 planned pages would legitimately
have to say "insufficient data for your county" rather than serve
content — a second, independent ceiling on top of the search-volume one.
**Recommend Olivia decide whether to continue building this site at all,
or fold whatever gets built into a small supporting page cluster on an
existing property (e.g. a "well water" section on TapWaterCheck) rather
than a standalone site** — this is a judgment call for her, not something
this research step can resolve, but the numbers are unambiguous enough
that it would be dishonest to file this as a routine "apply at threshold"
case the way TapWaterCheck's weaker-but-real ceiling was.

This does not change what happens in this step: every route below is still
researched to the same depth as every sibling site, on the chance the build
proceeds anyway as a portfolio property.

---

## Ranked by expected revenue per 1,000 visits

| # | Route | Rate (sourced) | Est. $/1,000 visits (0.5–2% conv, sourced range) | Status |
|---|---|---|---|---|
| 1 | American Home Shield (AHS) home-warranty lead-gen, well-pump coverage | $18/lead or $30/sale via Impact; also on CJ, FlexOffers; 30–60 day cookie | ~$90–600 | Needs Impact/CJ account (Olivia) + traffic |
| 2 | Choice Home Warranty lead-gen | $20/lead or 5–10% of sale via FlexOffers; 30-day cookie | ~$100–200+ | Needs FlexOffers account (Olivia) + traffic |
| 3 | Tap Score / SimpleLab well-water test-kit affiliate | 10% commission, 90-day cookie, Advanced Well Water kit ~$290 | ~$14–29/sale, ~$70–150/1,000 at 0.5–1% conv | Needs Awin/Refersion account (Olivia, same account as TapWaterCheck) + traffic |
| 4 | National Testing Laboratories (WaterCheck/WellCheck) well test kits | No publisher-facing affiliate program found — "Dealer Advantage Program" is a wholesale-dealer relationship, not a CPA affiliate scheme | Unknown — dealer only | **NEVER for now** — no affiliate marketplace found |
| 5 | Display ads — AdSense | $6–15/1,000 pageviews (no traffic floor) | $6–15 | **Build now, apply now once content bar met** — necessary, not sufficient alone |
| 6 | Display ads — Raptive / Mediavine Journey / Ezoic | 25k pageviews / 1k sessions / 250k MAU respectively | $8–50/1,000 (once qualified) | Needs traffic this niche cannot plausibly supply standalone |
| 7 | Well/water-treatment equipment affiliates (SoftPro iron filters, etc.) | No official affiliate program found for SoftPro; third-party review sites imply an undisclosed program exists but no signup terms located | Unknown | Park — revisit if a documented program surfaces |
| 8 | Amazon Associates (well pumps, tanks, iron filters) | 3–4% typical for tools/home-improvement category; well-pump-specific rate not separately published | ~$5–15 (low-intent add-on) | Needs Amazon Associates account (Olivia); 3-sale/180-day rule |
| 9 | Well-drilling contractor lead-gen (general contractor marketplace proxy) | No well-drilling-specific CPL marketplace found; general Angi/HomeAdvisor contractor leads run $15–120, shared 3–8 ways, no publisher-side payout rate published | Unknown — proxy only | **NEVER for now** — no real publisher-facing marketplace found |
| 10 | FlexOffers / any general affiliate network, applied broadly | Free to join, no published floor, but declined PanelFit outright at 4 days old / 7 impressions | — | **NEVER before real, sustained traffic** |
| 11 | Data licensing / API | USGS NWIS/NGWMN data is public domain; no buyer found incorporating groundwater-depletion-by-address specifically (ATTOM's hazard product line does not include it, same finding as TapWaterCheck's pass) | — | **NEVER for now** — speculative, no market found |
| 12 | Site sale | 30–45x monthly net profit (Flippa) | — | **NEVER before there is profit to multiply** |

---

## 1. American Home Shield (AHS) — best-fitting route, still nowhere near enough

This is the closest thing to a natural fit this site has: a well pump that
is about to fail (which is exactly what a declining water table forces —
pumps have to reach further and work harder, and can run dry and burn out)
is a **named, dollar-capped covered repair** under AHS's plans — up to
**$1,500 per term** for well-pump access, diagnosis, repair or
replacement. That is a specific, sourced reason a visitor reading "your
local water table has dropped 15 feet in 20 years" would plausibly click
"protect your well pump" rather than a generic warranty upsell.

**Sourced**: **$18 per lead or $30 per sale**, tiered/negotiated rates seen
up to $15–17 per lead and 15% on sales at some networks; **30–60 day
cookie**; available via **Impact**, and also listed on **CJ (Commission
Junction)** and **FlexOffers**. AHS's own public "referral program"
($25 Amazon gift card per referred member) is a **customer-referral**
scheme, not the publisher affiliate program, and is not the route to use.

### Qualification checklist
| Requirement | Site now | Gap |
|---|---|---|
| Content that specifically frames well-pump failure risk from declining water tables | Fits by design once framed correctly | not built yet |
| Named-author About, Contact, Privacy, Terms | Not built yet | **build requirement**: `content` step |
| Impact or CJ account | **Not held** | needs Olivia |
| Live, indexed traffic | No — not deployed | months out, and per the ceiling above, may never clear a meaningful volume standalone |

**Verdict: APPLY AT — real, indexed traffic**, same as every sibling site's
affiliate routes, but flagged: even at 100% capture of the entire 10/month
niche, this route alone is 138,900% short of $1,000/month. Parked to
`idea.js` for the traffic half; account for Olivia below.

## 2. Choice Home Warranty

Same shape as AHS — well-pump coverage is a standard home-warranty line
item industry-wide, not AHS-specific. **Sourced**: **$20/lead or 5–10% of
sale**, **30-day cookie**, via **FlexOffers**. Functionally interchangeable
with AHS as a second warranty option to compare, which content sites in
this space typically do (comparison table, not single-brand push).

### Qualification checklist
| Requirement | Site now | Gap |
|---|---|---|
| Well-pump-failure-risk framing tied to the site's own trend data | Fits by design | not built yet |
| FlexOffers account | **Not held** | needs Olivia — note FlexOffers' own general acceptance bar (route 10) |
| Live, indexed traffic | No | same gap as route 1 |

**Verdict: APPLY AT — real, indexed traffic.** Parked to `idea.js`.

## 3. Tap Score / SimpleLab — Advanced Well Water Test

Same company and affiliate mechanics already verified for TapWaterCheck
(**10% commission, 90-day cookie, Refersion + Awin, merchant #92253**), but
this site's natural CTA is Tap Score's **well-water-specific kit** (tests
for private-well contaminants — bacteria, nitrate, arsenic — that a
public-system SDWIS lookup can't cover, and that TapWaterCheck's own
premise structurally excludes since it covers public systems only). Kit
priced similarly to the "Advanced" tier already sourced for TapWaterCheck
(~$290), so **~$29/sale** at 10%.

**Note for Olivia**: if the Awin/Refersion account gets opened for
TapWaterCheck, the same account covers this site — no separate signup.

### Qualification checklist
| Requirement | Site now | Gap |
|---|---|---|
| Content framing "your well isn't tested by anyone — is it dropping AND is it safe" | Fits by design, connects the two datasets (level trend + private-well contamination risk) | not built yet |
| Awin/Refersion account | **Not held**, but may already exist if opened for TapWaterCheck | needs Olivia to confirm/reuse |
| Live, indexed traffic | No | same gap as routes 1–2 |

**Verdict: APPLY AT — real, indexed traffic**, and reuse the TapWaterCheck
account if it exists rather than reapplying. Parked to `idea.js`.

## 4. National Testing Laboratories (WaterCheck/WellCheck) — no affiliate programme found

Checked as the direct well-water-specific competitor to Tap Score. Their
only documented partner-facing scheme found is a **"Dealer Advantage
Program"** — bulk kit ordering and marketing materials for **retail
dealers reselling physical kits**, not a CPA/commission affiliate link
programme for content publishers. No commission rate, cookie window, or
publisher signup process was found.

**Verdict: NEVER for now.** Not a real avenue in the form this site needs;
revisit only if NTL launches a publisher affiliate programme.

## 5. Display ads — AdSense — build now regardless

Google's eligibility bar, re-verified this pass and unchanged from the
same-day TapWaterCheck research (2026-08-27): **no minimum traffic, no
mandatory post count, no six-month domain-age rule** — what gates approval
is genuine original content (commonly cited ~15–20+ pages, 800–1,200+
words), a professional mobile-friendly layout, and **About, Contact,
Privacy, Terms**.

**Framing note carried over from the radon/wildfire/flood precedent**:
groundwater depletion is a property/financial-risk topic, not a health
topic, so it doesn't trip AdSense's health-content restrictions at all —
the actual risk is the **uneven-coverage problem** `candidates.json`
flagged: many counties will have no nearby monitoring well, and those pages
must say so honestly ("insufficient monitoring data for this county") to
avoid both a factual-accuracy problem and a thin/padded-content pattern
that would fail AdSense's "genuine expertise" bar site-wide if too many
pages are near-empty templates.

### Qualification checklist
| Requirement | Site now | Gap |
|---|---|---|
| About/Contact/Privacy/Terms, named author | Not built yet | **build requirement**: `content` step |
| 15–20+ genuinely varied pages, not padded "insufficient data" boilerplate | Not built; ~1,800 candidate pages but many may be data-thin | **build requirement**: decide the real page count after the `dataset` step reveals actual monitoring-well coverage, not before |
| ads.txt | Not present | **build requirement**: `install` step |
| Under the 15-site-per-account cap | Existing AdSense account already carries several sibling sites | check before adding another |

**Verdict: APPLY NOW, once `content` and `deploy` steps are done** — but
per the ceiling above, this alone or combined with every other route here
still falls short by orders of magnitude at this niche's real volume.
Install as backstop revenue only.

## 6. Display ads — Raptive / Mediavine Journey / Ezoic

Same thresholds verified same-day for TapWaterCheck, unchanged: **Raptive
25,000 monthly pageviews**, **Mediavine Journey 1,000 sessions/month**
(auto-upgrades to the main programme at $5,000/year earned), **Ezoic
250,000 monthly active users**. TapWaterCheck's research already flagged
Journey's 1,000-session floor as "close to the entire realistic traffic
ceiling" for a niche with 930 realistically-capturable visits/month at
6,200 total search volume. **This site's realistically-capturable ceiling
is 2 visits/month** — Journey's floor is 500x this site's entire addressable
traffic, not a stretch goal.

**Verdict: NEVER at this niche's standalone volume** — not "apply at
threshold," because the threshold itself is unreachable by the niche as
scoped. No `idea.js` entry with a real trigger can be written here; this
route only becomes real if the site's traffic comes from something wider
than the scouted query family (e.g. it becomes one section of a larger
water-topics property).

## 7. Well/water-treatment equipment affiliates (SoftPro and similar)

Checked SoftPro specifically (a well-water iron-filter brand) as a
plausible direct-brand affiliate akin to TapWaterCheck's Berkey/Aquasana
routes. **No official SoftPro affiliate program page or signup terms were
found** — only third-party review sites (watertechadvice.com,
qualitywaterlab.com) that disclose earning commissions on SoftPro links,
implying *some* program exists (likely via a network rather than direct),
but no commission rate, network name, or cookie window could be sourced
this pass.

**Verdict: Park, don't apply.** Unlike TapWaterCheck's six confirmed filter
brands, this could not be confirmed as a real, joinable programme with
sourced terms — revisit with a direct outreach/lookup pass rather than
assuming the review-site pattern implies terms this site could rely on.

## 8. Amazon Associates

Same **3–4% typical rate** and **3-sale/180-day retention rule** structural
risk flagged on every sibling site. Well pumps, pressure tanks, and iron
filters sold on Amazon skew toward the equipment/home-improvement
category at the low end of Amazon's rate card, with no well-pump-specific
rate published. At blended AOV and the standard 0.5–1% conversion
benchmark, roughly **$5–15/1,000 visits** — the weakest route researched.

### Qualification checklist
| Requirement | Site now | Gap |
|---|---|---|
| Amazon Associates account | **Not held** | needs Olivia |
| 3 sales within 180 days of approval | N/A yet | don't apply until traffic can plausibly clear this — this niche's ceiling makes that especially unlikely |

**Verdict: APPLY AT — traffic sufficient to plausibly clear the 180-day
bar**, acknowledging that bar may never be reachable standalone. Parked to
`idea.js`.

## 9. Well-drilling contractor lead-gen — no real dedicated marketplace found

The closest analogue to WildfireRiskCheck's insurance-lead route or
FloodZoneCheck's flood-insurance route would be "get quotes for a deeper
well" — and like TapWaterCheck's water-softener-installer finding, it does
not hold up. **No well-drilling-specific CPL marketplace** (an
Insurify/SmartFinancial equivalent for well drillers) was found. The only
sourced number is the **general Angi/HomeAdvisor contractor-lead proxy**:
$15–120 per lead, shared across 3–8 competing contractors, 10–20% shared-
lead close rate — not well-drilling-specific, and (as with every sibling
site's version of this finding) this is what a *contractor* pays a
*marketplace*, not a publisher-facing payout rate.

**Verdict: NEVER for now.** Same category as TapWaterCheck's
water-softener-installer finding: not a "needs traffic" gap, a "no
publisher-facing programme exists" gap. No `idea.js` entry — no threshold
to wait for.

## 10. FlexOffers / any general affiliate network

Same finding as every sibling site: free to join, no published floor, but
**declined PanelFit outright at four days old with 7 impressions**. Choice
Home Warranty (route 2) is itself listed on FlexOffers, so this isn't a
route to skip, just one to delay until real, sustained traffic exists.

## 11. Data licensing / API

USGS NWIS/NGWMN groundwater-level data is **public domain**, same finding
as every government-sourced sibling site. Re-checked whether ATTOM's
hazard-data product line (already found to exclude tap-water quality for
TapWaterCheck) includes groundwater depletion: **it does not** — ATTOM's
Climate Change Risk and Environmental Hazard Risk products cover wildfire,
flood, heat, storm, drought, air quality, landslides, and radon, not
well/aquifer depletion. No other buyer found.

**Verdict: NEVER for now.** No `idea.js` entry — speculative, no market
found.

## 12. Site sale

**30–45x monthly net profit** (Flippa) — meaningless before there is
profit. **NEVER before there is profit to multiply**, and per the ceiling
above, profit here may never materialize on the niche as scoped.

---

## What the template must therefore include

- About page with a **named author**, Contact, Privacy, Terms — required
  for AdSense and every affiliate-network application, same as every
  sibling site
- `ads.txt`
- A **primary CTA slot** framed around well-pump-failure risk from a
  dropping water table, feeding the home-warranty routes (AHS/Choice),
  empty target id wired to disclosure text
- A **secondary CTA slot** for the Tap Score well-water contamination test,
  distinct from (and complementary to, not competing with) the primary slot
  — this site's depletion data and a contamination test answer two
  different questions
- **Honest "insufficient monitoring data for this county" pages** wherever
  NGWMN well density doesn't support a real trend read — a factual-accuracy
  requirement flagged in `candidates.json`, and separately a defense
  against a thin-content pattern that would hurt AdSense approval site-wide
- Content in a **factual, cited, non-alarmist register** (name the USGS
  station, the years compared, the actual decline rate) — never "your well
  WILL run dry" framing where the data is a modeled trend, not a certainty

## Three buckets — sorted explicitly

**(a) Something the site build can satisfy now:**
- About/Contact/Privacy/Terms pages with a named author
- `ads.txt`
- Home-warranty CTA slot (AHS/Choice, empty target id) + Tap Score
  well-water-test CTA slot (empty target id), both wired to disclosure text
- Honest "insufficient data" template variant for low-well-density counties
- Factual/cited/non-alarmist content register on every page

**(b) Something only time/traffic can satisfy** (park with threshold, not
block):
- AHS application (Impact/CJ) — at real, indexed traffic
- Choice Home Warranty application (FlexOffers) — at real, indexed traffic
- Tap Score/Awin application (or reuse TapWaterCheck's account) — at real,
  indexed traffic
- Amazon Associates application — at traffic sufficient to plausibly clear
  the 3-sale/180-day rule (may never be reached standalone)
- Mediavine Journey / Raptive / Ezoic — thresholds this niche's scouted
  query family cannot plausibly reach standalone; only realistic if this
  content becomes part of a larger property
- FlexOffers / any general network broadly — only after real, sustained
  traffic

**(c) Something needing an account/signature/money/permission:**
- Impact or CJ account (American Home Shield)
- FlexOffers account (Choice Home Warranty; also Choice is listed here so
  one signup covers it)
- Awin/Refersion account (Tap Score) — confirm whether TapWaterCheck's
  account can be reused before opening a new one
- Amazon Associates account
- AdSense account (add as a new site to the existing multi-site account)

## Recommendation to Olivia (not a build/kill decision this step can make)

This niche's measured search volume (10/month, Google Ads Keyword Planner)
cannot support $1,000/month under any monetization model researched, by
three to four orders of magnitude even in the best case — the worst result
of every site scouted so far, including TapWaterCheck's already-weak
ceiling. The build requirements above are worth doing regardless (cheap,
and forward-compatible if this becomes a section of a larger site), but the
traffic assumption behind treating this as a standalone $1,000/month
property should be revisited before further build investment goes in.

## Sources

- [Tap Score Water Testing Affiliate Program — Refersion](https://simplewater.refersion.com/)
- [Awin | SimpleLab, Inc Affiliate Program](https://ui.awin.com/merchant-profile/92253)
- [Tap Score — well water test kits, Advanced tier](https://mytapscore.com/)
- [American Home Shield Affiliate Program — getlasso.co](https://getlasso.co/affiliate/american-home-shield/)
- [American Home Shield Affiliate Program — FlexOffers](https://www.flexoffers.com/affiliate-programs/american-home-shield-affiliate-program/)
- [American Home Shield — US Home Warranty Affiliate Program — Affpaying](https://www.affpaying.com/americanhomeshield)
- [Well Pump Warranty | Protection Plans & Coverage — AHS](https://www.ahs.com/our-coverage/additional-coverage/well-pumps/)
- [Choice Home Warranty Affiliate Program — getlasso.co](https://getlasso.co/affiliate/choice-home-warranty/)
- [Choice Home Warranty Affiliate Program — FlexOffers](https://www.flexoffers.com/affiliate-programs/choice-home-warranty-affiliate-program/)
- [Affiliate Program | Choice Home Warranty](https://www.choicehomewarranty.com/affiliate-program/)
- [National Testing Labs (NTL) WaterCheck / WellCheck — knowyourh2o.com](https://www.knowyourh2o.com/partners/national-testing-labs)
- [WaterCheck Testing Kits — Dealer program, Pure Water Products](https://www.purewaterproducts.com/watercheck/)
- [SoftPro AIO Iron Master — softprowatersystems.com](https://www.softprowatersystems.com/products/iron-master-iron-filter-for-well-water)
- [SoftPro Iron Master Review — disclosed affiliate commission, watertechadvice.com](https://watertechadvice.com/softpro-iron-master-review/)
- [Amazon Affiliate Commission Rates By Category 2026 — Azonpress](https://azonpress.com/amazon-affiliate-commission-rates/)
- [Angi vs. HomeAdvisor: Which Lead Generation Platform — Jobber Academy](https://www.getjobber.com/academy/homeadvisor-vs-angi/)
- [Real Cost of Contractor Leads 2026 — HOMESHOWOFF](https://homeshowoff.com/real-cost-of-contractor-leads/)
- [Eligibility requirements for AdSense — Google AdSense Help](https://support.google.com/adsense/answer/9724?hl=en)
- [Raptive Drops Traffic Requirement By 75% To 25,000 Views — Search Engine Journal](https://www.searchenginejournal.com/raptive-drops-traffic-requirement-by-75-to-25000-views/558780/)
- [Journey Minimum Requirements — Journey (Mediavine)](https://journeymv.zendesk.com/hc/en-us/articles/24633185741723-Journey-Minimum-Requirements)
- [Getting Started: Ezoic's Requirements](https://support.ezoic.com/kb/article/getting-started-ezoics-requirements)
- [ATTOM Environmental Hazard Risk Data — attomdata.com](https://www.attomdata.com/data/hazard-risk-data/)
- [FlexOffers: How can I tell what traffic will be accepted](https://support.flexoffers.com/hc/en-us/articles/360042476812-How-can-I-tell-what-kinds-of-traffic-will-be-accepted-by-this-affiliate-program)
- [Affiliate Website Valuation — Flippa](https://flippa.com/blog/affiliate-website-valuation-how-to-properly-determine-it/)
- `scout/candidates.json` and `scout/ranked.json` — SiteFactory internal
  (groundwater-well-depletion entry: 10 monthly queries measured via
  `scout/volume.js`/Google Ads Keyword Planner, decision 0.65, avenues
  listed)
- `~/sitefactory/drinkingwatercheck/revenue.md` — sibling research reused
  for Tap Score mechanics, AdSense/ad-network thresholds, and ATTOM finding
