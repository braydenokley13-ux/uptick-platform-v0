# Founder demo and artifact verification

Date: September 15, 2026. Software: `32706bb4b9c0d2e9c6fcf52dd45ba09894e5e7d4` on `codex/real-enrollment-ready`.

This report records observations from the tool transcript. It is not a fabricated raw browser or HTTP log. The final source has no runtime edits after that software commit; the later handoff commit contains documentation and artifacts.

## Actual laptop journey

1. `npm run demo:reset` completed successfully using the owned local PGlite database. `npm run demo` launched the application on loopback port 3210. PGlite uses the owned filesystem database; port 3211 is only the launcher’s local process lock, not a database listener.
2. In the real browser UI, Studio opened member entry with fictional phone `(202) 555-0123` and ZIP `10583`. The adult checkbox was checked and optional promotional consent remained off.
3. The simulated access response explicitly said no text was sent. Opening the one-time local link and clicking **Join & open my Uptick** completed confirmation.
4. Your Uptick displayed a backed free 12 oz coffee at Sample Fuel & Market. Claiming it produced the real private-pass flow.
5. **Use this pass at Uptick Tap** prepared the pass. Studio's staff QR destination opened the same URL encoded by the displayed QR. **Confirm & redeem at this counter** recorded the redemption and timestamp.
6. The authenticated sample merchant results showed one issued placement, one claim and one recorded redemption.
7. Studio recorded a stockout after digital redemption but before physical handoff. Issuing sample recovery reserved the separate bottled-water fallback.
8. The member opened the recovery pass, prepared it for Tap, revisited the staff QR and confirmed recovery redemption. Your Uptick reported the remedy as redeemed while keeping the coffee redemption visible.
9. Studio displayed claims/redemptions/incidents/recoveries/recovery redemptions as **1/1/1/1/1**. Operator fulfillment history showed the redeemed current remedy. Operator overview still showed real launch checks and zero remaining admissions for the frozen cohort.
10. After Control-C and reset, all five Studio counters returned to **0/0/0/0/0** and the sample QR changed. Rehearsal and capture steps were repeated on the same software to improve screenshots. The final handoff stops the demo and completes one last reset, leaving it ready for the founder to launch.

No hosted member, stock or commitment was created. The demo's launcher strips hosted environment files and uses sample development messaging. Read-only hosted inspection elsewhere in this task is separate from the demo process.

## API and mobile checks

- Final running HTTP/API check: **13/13 passed**, zero failed, approximately 8.9 seconds. The checks cover wrong-origin mutations, protected privacy/readiness routes, unsigned callbacks, body limits, forged credentials and role/tenant boundaries. They use HTTP requests, not an alternate browser driver.
- An earlier readiness-route assertion used POST against a GET-only route and observed 405. The check was corrected to exercise the implemented read method, then all 13 checks passed.
- [Mobile measurements](../../../demo/mobile-checks.json) contain **60** observations at 320, 360, 390 and 430 CSS pixels across 15 scenes. All reported document widths were at or below the viewport width.
- Saved image dimensions are **1440 × 1000** desktop and **390 × 844** phone. There are **36 PNGs**, covering 18 scenes.

## Offline packet

`output/pdf/uptick-founder-demo.pdf` has **21 landscape pages**: introduction, basic launch instructions, 18 scene pages and an evidence/next-actions page. It embeds all 36 application captures and local fonts. It has no JavaScript or required remote assets.

Every page was rendered with Poppler and visually inspected. Screenshot files use viewport captures; a long page may require scrolling in the live app. Narrative text explains the action and expected result. The completion captures show the recorded recovery state, and the separate ledger scene preserves its counts.

Capture tools encountered stale tabs after server restarts, navigation timeouts and incorrect viewport dimensions. Fresh tabs and replacement captures resolved those issues. The packet combines verified scenes from repeated rehearsals of the same final software; it is not represented as a continuous recording. All visible phone numbers and QR/pass credentials belong to disposable local sample data. Reset invalidates the sample credentials.

The artifact manifest in this folder records SHA-256 hashes for the final PDF, screenshots, mobile measurements and public-policy bundle. Hashes establish which files were reviewed; they do not prove hosted readiness.

## Limits

Opening the QR destination on one laptop exercises the actual credential flow. A two-device physical camera scan was not separately commissioned. Digital redemption is credential-use evidence, not purchase or physical handoff proof. Synthetic counts are not traction. The live host remains on the older release and real enrollment stays closed.
