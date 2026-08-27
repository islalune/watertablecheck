# WaterTableCheck — revenue routes

Researched 2026-08-27, before the dataset pipeline or template exist, following
the same order as every prior sibling site.

**Every number below is sourced.** Where a figure could not be verified for
this specific vertical it is marked unverified/unknown, not estimated — a
guessed rate is worse than none because the whole site gets planned around it.

The site: enter a US county, get a read on whether the local water table /
aquifer is trending down over the long-term USGS monitoring record — pitched
at well-dependent rural/exurban homeowners and buyers asking "will my well run
dry," not a live water-level readout. Per `scout/ranked.json` (candidate id
`groundwater-well-depletion`), the dataset is USGS NWIS groundwater levels +
NGWMN, free, with a claimed capacity of **~1,800 county pages**. Scout's
honesty-relevant scores: **defensibility 0.75 (high — genuinely no consumer
lookup incumbent found)**, **rpm 0.35**, **affiliate 0.45**, **money 0.415**.

**Scout's own measured `monthly` search volume for this candidate is 10.**
Ten searches a month, summed across its seed query family. This is even
lower than RealWeatherCheck's 70 (the lowest previously built sibling) and is
the smallest `monthly` figure of any site built to date. The four seed
queries — *"is the water table dropping near me," "will my well run dry,"
"groundwater level trend my county," "aquifer depletion near me"* — are real
homeowner-intent phrasings, not generic template noise, so this is a
narrow-but-real audience rather than a mismeasured one. The problem is scale:
well-dependent households are a minority of US homes, and the fear itself
("will my well run dry") is not something most well owners actively google
until a well is already showing symptoms.

---

## The honest ceiling — run first, before anything else

`factory/target.js` converts $1,000/month into a visit count and checks it
against realistically capturable traffic (top-3 ranking, 15% CTR). At 10
searches/month, realistically capturable traffic is **2 visits/month**.

| Model | Rate used (sourced below) | Monthly visits needed | Realistically capturable (2/mo) | Verdict |
|---|---|---|---|---|
| Display ads, AdSense | $6 RPM | 166,667 | 2 | **NOT reachable — needs 11,111,111%** |
| Lead-gen, low proxy | $5/lead × 2% conv | 10,000 | 2 | **NOT reachable — needs 666,667%** |
| Lead-gen, confirmed-adjacent mid | $15/lead × 2% conv | 3,333 | 2 | **NOT reachable — needs 222,222%** |
| Lead-gen, best-case unverified ceiling (Google LSA well-drilling proxy) | $70/lead × 2% conv | 714 | 2 | **NOT reachable — needs 47,619%** |

Every model tested fails by between roughly **476x and 111,000x**. This is
worse than RealWeatherCheck's already-worst-to-date result (95x-15,900x) by a
wide margin, because this niche's measured search volume (10/mo) is lower
still. **$1,000/month is not reachable on any sourced model, not by a small
margin, and not by stacking routes** — stacking does not close a gap of two
to five orders of magnitude.

**Recommendation: build a minimal, low-effort version if built at all — ads
wired for free background revenue, no dedicated lead-gen integration work, no
time spent chasing affiliate applications — and do not plan any of Olivia's
income around this site.** The per-page content still has real standalone
utility for the (small) audience actually asking this question, and reuses
USGS-pipeline patterns other sibling sites may already have. But there is no
honest case for treating this as a revenue site.

---

## Ranked by expected revenue per 1,000 visits

| # | Route | Rate (sourced) | Est. $/1,000 visits | Status |
|---|---|---|---|---|
| 1 | Water filtration/treatment affiliate (Crystal Quest, SpringWell, US Water Systems, Epic Water Filters) | 10-20% commission, confirmed live on each vendor's own site; whole-house system AOV $1,800-2,000 (multiple 2026 cost guides) | ~$180-400 per SALE, but conversion from a well-depletion-intent page to a filtration purchase is unsourced and the topical fit is weak (depletion is a supply problem, filtration solves a quality problem) | **APPLY AT** low priority — weak fit, real rates |
| 2 | Well drilling / pump replacement contractor lead-gen (direct, or via Modernize/Angi/HomeAdvisor) | **No confirmed publisher-facing affiliate program found** for well drilling or pump repair specifically on FlexOffers or elsewhere this pass. Modernize and Angi both run well-pump-repair cost-guide pages and match contractors, and Google LSA reports well-drilling leads sell to contractors at $25-70/contact — but that is what a contractor pays Google/Angi, not a confirmed publisher payout, the same proxy caveat every sibling site's research has flagged for this category | Unknown — cannot be responsibly estimated without a confirmed publisher rate | **Unresolved** — worth a direct outreach to Modernize/Networx once there's traffic, do not plan around the LSA figure |
| 3 | Display ads — AdSense | $6-12/1,000 pageviews, no traffic floor | $6-12 | **Build now, apply now** — necessary, not remotely sufficient |
| 4 | Display ads — Ezoic / Raptive / Mediavine (once qualified) | $8-50/1,000 (once qualified) | $8-50 | Needs traffic — every threshold is 25,000x+ this niche's realistic ~2/mo ceiling |
| 5 | Real-estate / well-disclosure referral (a home inspector or well-water-test-at-closing angle) | No sourced publisher rate found this pass — same "cannot be responsibly estimated" situation as several siblings' HomeLight/Clever research | — | **Unresolved** — revisit only with traffic |
| 6 | Data/API licensing of USGS groundwater levels | USGS NWIS/NGWMN data is public domain, explicitly open with attribution only; no exclusivity to license | — | **NEVER** — no moat, same reasoning as every sibling's public-data licensing route |
| 7 | Widget/embed licensing (standalone) | No buyer market found distinct from #6 | — | **NEVER** |
| 8 | Sponsorship / site sale | Meaningless with no profit | — | **NEVER before there is profit to multiply** |

---

## 1. Water filtration/treatment affiliate programs

Several vendors run their own confirmed, live affiliate programs: **Crystal
Quest** (15% commission, no cap, direct from their own affiliate page),
**SpringWell** (10-20% depending on product), **US Water Systems** (10%),
**Epic Water Filters** (15%). Whole-house system AOV runs **$1,800-2,000**
per multiple independently-sourced 2026 cost guides (HomeGuide, Angi,
HomeBuddy). At 15% on a $1,800 AOV, a single converted sale is worth **~$270**
— a real number, if a real sale happens.

The topical fit is the weak point: someone worried their well is running dry
wants more water or a deeper well, not necessarily filtration for the water
they still have (that is DrinkingWaterCheck's territory, not this site's).
The honest connection is thin (e.g., "if your well's yield drops, remaining
water can concentrate minerals" is a real but secondary point), so this is a
low-priority, low-conversion-probability route even before the top-line
traffic problem.

### Qualification checklist
| Requirement | Site now | Gap |
|---|---|---|
| Live site with real, indexed search traffic | No — not built | needs deploy + months of indexing |
| A natural, honest "if concentration changes bother you, here's filtration" mention | Not built | cheap to add as a secondary aside, not a primary CTA |
| Any of the four vendors' affiliate programs | **Not held** | needs Olivia to sign up (self-serve on each vendor's site, no approval gate found) |

**Verdict: APPLY AT, low priority.** Real rate, weak fit, and the traffic
problem dwarfs both.

## 2. Well drilling / pump replacement lead-gen

No named, confirmed, publisher-facing pay-per-lead programme was found this
pass for well drilling or pump repair specifically — unlike TopMoving
(moving), Groundworks (foundation), or Renewal by Andersen (windows) in prior
sibling research, this category does not appear to have a well-known
affiliate-network listing. Modernize and Angi both operate cost-guide pages
in this exact category and both broker contractor leads, and Google LSA
(Local Services Ads) reports well-drilling contractors pay **$25-70 per
contact** — but per the same caveat every sibling's Modernize/Networx research
has flagged, that is the advertiser-side cost, not a confirmed publisher
payout for referring a lead.

### Qualification checklist
| Requirement | Site now | Gap |
|---|---|---|
| Live site with real, indexed search traffic | No — not built | needs deploy + months of indexing |
| A "get a well inspection/quote" CTA on county pages | Not built | cheap to add once a programme exists to point it at |
| A confirmed publisher-facing programme (Modernize/Networx affiliate terms, or a direct contractor-network deal) | **Not researched to a confirmed rate** | needs direct outreach to Modernize/Networx once there's traffic to justify the conversation |

**Verdict: Unresolved, not APPLY NOW.** No confirmed rate exists to plan
around; logging to idea.js for direct outreach once traffic exists, per the
qualification-bucket rule (this is a "needs more research/an account"
requirement, not a build requirement).

## 3. Display ads — AdSense, Ezoic, Raptive, Mediavine

Same verified 2026-08-27 thresholds used across every sibling site this
month: **AdSense** has no traffic floor, no post-count minimum, no six-month
domain-age rule — approval gates on original content, a professional layout,
and the four standard pages (About with a named author, Contact, Privacy,
Terms). `site.config.json` will carry `revenue.adsenseId`
(`pub-1937434719533429`), the same shared multi-site publisher ID as every
sibling. **Raptive** 25,000 monthly pageviews, **Mediavine** main tier now
$5,000 trailing-12-month ad revenue (Journey on-ramp at 1,000 sessions/mo),
**Ezoic** 250,000 MAU. Every one of these is tens of thousands of times this
niche's realistic ~2 visits/month ceiling.

---

## Build requirements this research adds to the spec

Bucket (a) — build can satisfy now: the standard about/privacy/terms/contact
pages with a "Written by" AI-disclosure block (same pattern as every sibling,
required for AdSense eligibility regardless of affiliate status), and an
honest per-county "insufficient monitoring-well data" fallback page rather
than padded coverage (scout's own note flags uneven well density).

Bucket (b) — needs traffic, logged to `factory/idea.js`: premium display ad
networks, and direct Modernize/Networx outreach for well-drilling lead-gen.

Bucket (c) — needs an account: AdSense (deferred at that step, no
browser on this VM), water-filtration vendor affiliate signups (self-serve,
can be done without Olivia once approved-for-build, logged as low priority
given the weak fit and near-zero traffic).
