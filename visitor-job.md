# watertablecheck: the visitor's job [R21]

Written 2026-11-11 from the site's own data (src/data/counties.csv, USGS NWIS + NGWMN) and a search of what well owners ask state agencies and forums. Every page follows this [R20, R21].

## WHO LANDS
Mostly people on a private well, or about to be. They searched things like "is the water table dropping in <county>", "<county> groundwater level", "will my well go dry" or "how deep is the water table here". Three kinds:
- A well owner whose pressure is sputtering, whose neighbour's well just went dry, or who keeps reading drought news. Worried, one county in mind, wants to know if this is a dry summer or a long fall.
- Someone buying rural land or a house on a well, deciding whether the well will last and how deep a new one would have to go.
- Someone in a city or farm county who heard the aquifer is being pumped down and wants the real number.
They are not browsing. A new or deepened well runs roughly $6,000 to $16,000 for 200 feet and often more (HomeServe cost guide), and standard homeowners insurance usually does not pay when a well goes dry from a low water table, so they want the answer before they spend money.

## THEIR QUESTIONS (most urgent first)
1. Is the water table dropping in my county, and how fast? (the county's monitoring-well trend in feet per decade, with the well id and the date of its latest reading)
2. How deep is the water here right now? (the latest depth to water at that well, compared with the state's other measured counties)
3. Is my own well at risk? (only their well's record can say: drilled depth and pump depth against the local depth to water and the rate it is falling. Most states publish well records free: Minnesota Well Index, Texas Groundwater Database, Oklahoma's water-level search, Wisconsin DNR, Illinois State Water Survey, Maine Geological Survey)
4. Is it a dry season or a long decline? (the trend uses 15+ years of readings, so one summer does not move it; Tennessee's drought guidance notes levels normally fall in dry months and recover in wet ones)
5. My well quit. What now? (rule out the pump and plumbing first, then lower the pump, clean or hydrofracture, and only then deepen or drill new, with a licensed driller and a written estimate: South Carolina DES and Tennessee well-owner guidance)

## THE ONE ACTION
Look up your own well's record on your state's free well search, and compare its drilled depth with your county's depth to water and how fast that depth is falling. If you have no record, measure the static water level yourself (pump off two hours first, steel tape or a sounder, per Oregon State and University of Arizona extension guides) or ask a licensed driller.

## FIRST SCREEN
County pages (the visitor's real answer): their question as the headline ("Is the water table dropping in Maricopa County?"), then the one giant local number (the trend, e.g. 28 ft per decade, with "deeper since <first year>, last read <date>, well <id>" set beside it, not under it), then one electric pink line saying what it means in plain words ("Every ten years a well here needs about 28 more feet of reach"), then one plain line with the action: find your well's depth on your state's well record and compare. A stale reading (older than about 5 years, e.g. Los Angeles County's last reading is 2018) says so on the first screen, not in a footnote.

Homepage: the visitor has not told us their county yet, so the giant number is the national one: 494 of the 1,449 counties with a qualifying long-term well are dropping (602 stable, 353 rising). The pink line says what that means. The action line sends them to their county. The county search lives just below the first screen, designed into the ground cross-section, not a form box [R18, R27].

Approved look (docs/refs/approved-leadpipes-hero.png): painted art full width, text only in empty space and never on a line of the art, Archivo condensed heavy caps in dark blue, pink once per screen, no top bar, no button, no cards, nothing small [R17-R20, R24]. Any font or colour change is shown to Olivia as a picture first [R8, R14, R25].

## BELOW THE FOLD
One screen per remaining question, each about the visitor's own county and each with a source link:
- How deep the water is now, and where that ranks in the state.
- Is my well at risk: the depth comparison, with a link to that state's own free well-record search.
- Dry season or long decline: the readings behind the trend, the span in years, how many measurements.
- If your well quit: the order to try things, from the state agency guidance above.
- Sources and limits: one USGS well stands in for the whole county; where a county has no qualifying well the page says so instead of guessing (those 1,773 pages are noindexed, carry no ads and stay out of the sitemap).
No long scroll of general reading. Information appears only when it is about the visitor's answer [R27].

## Sources used for this file
- Site data: USGS NWIS groundwater levels + NGWMN, src/data/counties.csv
- HomeServe well drilling cost guide: https://www.homeserve.com/blog/cost-guide/well-drilling
- South Carolina DES, what to do if your well goes dry: https://des.sc.gov/blog/what-do-i-do-if-my-well-goes-dry
- Tennessee drought well-owner info: https://www.tn.gov/content/dam/tn/environment/water/drinking-water-unit/wr_drought-well-owner-info.pdf
- Oregon State extension, measuring well water level: https://extension.oregonstate.edu/sites/extd8/files/catalog/auto/EC1368.pdf
- University of Arizona extension, build your own well sounder: https://extension.arizona.edu/publication/how-build-your-own-water-well-sounder
- State well-record searches: https://www.health.state.mn.us/communities/environment/water/mwi/ · https://www.twdb.texas.gov/groundwater/data/gwdbrpt.asp · https://www.owrb.ok.gov/wd/search/search.php?type=wl · https://dnr.wisconsin.gov/topic/Groundwater/Data.html · https://isws.illinois.edu/groundwater-science/well-records-public-service · https://www.maine.gov/dacf/mgs/pubs/digital/well.htm
