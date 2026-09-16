# Platform frontier — visual evidence, September 16 2026

Captured with Chromium against the running application on local storage, populated by
`scripts/seed-rehearsal.ts` (64 members, 64 issued, 57 claimed, 35 redeemed, 2 incidents
with 1 recovery, 1 location outage). All records are `internal`-classified; no real
member, no real store, no real SMS.

The Next.js development overlay badge is hidden in these captures so the product is
shown alone. It does not exist in a production build.

## before/

| File                    | What it shows                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `operator-overview.png` | The operator landing page opening on a "Create a four-week pilot run" form while a pilot was already live. |
| `member-join.png`       | The join page as one long, cool-toned scroll.                                                              |
| `merchant-program.png`  | The merchant landing on the growth-programs workspace.                                                     |

## after/

| File                                                 | What it shows                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `operator-command-centre.png`                        | Blocking line, four stats with their basis, Market Cell map, system readiness, four-week backing, this week's focus. |
| `operator-overview-1728.png`                         | The same at wide desktop.                                                                                            |
| `readiness-dependency-map.png`                       | Seven gates in dependency order with blocker, consequence, owner, next action and evidence expiry.                   |
| `messaging-support-console.png`                      | Provider state, both message classes, both signed callbacks, support queue, delivery outcomes.                       |
| `operator-store-operations.png`                      | Store operations after restructuring: 8160px → 2994px with no capability removed.                                    |
| `merchant-overview.png`, `merchant-overview-834.png` | The merchant's five answers, desktop and tablet.                                                                     |
| `member-reveal-390.png`                              | The weekly reveal.                                                                                                   |
| `member-redeemed-390.png`                            | The same week after redemption, with a state-aware greeting.                                                         |
| `member-home-320.png`, `member-home-430.png`         | The narrowest and widest required phone widths.                                                                      |

## Responsive sweep

Member 320/360/390/430, operator 1280/1440/1728, merchant 834/1180/1440.
**33 of 33 surfaces returned 200 with zero horizontal overflow** (`scrollWidth == clientWidth`).
