# L3 selector fault evidence

- Case: `WALLPAPER-BOTTOM-COVERAGE-002`
- Parent revision: `8ac47fc14e0a4c70021a10213bc9b180d9193299`
- Fault command: `node scripts/browser-regression.mjs --fault=bottom-selector`
- Expected failure: the real Chromium fixture retained `rgb(17, 17, 17)` on the short-content bottom panel instead of the required transparent computed style.
- Restored command: `node scripts/browser-regression.mjs --json`
- Green repeat: two consecutive runs produced the same 18 case results, the same 1000-input/100-scroll stress counters, and exact per-run Chrome profile/process cleanup.

The Red was caused by the deliberately wrong bottom-panel selector, not by fixture setup, browser discovery, syntax, or cleanup.
