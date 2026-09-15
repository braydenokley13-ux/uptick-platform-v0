# Application and demo UI refresh — 2026-09-15

## Scope

The founder's dashboard mockups inform the visual direction, not product scope. The application now uses a navy navigation rail, white cards, slate typography, and emerald actions/status accents. No invented business metrics, maps, recommendations, products, or integrations were added.

- Cloud landing page: visible Open demo entry, sample benefit preview, and the three perspectives of the journey.
- Demo Studio: six numbered action cards, saved sample counters, explicit isolation context, staff QR, and reset/end controls.
- Shared workspaces: updated brand, navigation, typography, forms, badges, and cards. The demo's topbar returns to Demo Studio rather than offering an unavailable account-security route.
- Operator Today: compact pilot selector; cohort metrics before the action checklist; first three action items visible with an explicit expandable remainder. All readiness items remain available.
- Merchant/program/network workspaces: consistent panel and table styles, readable labels, responsive forms and action rows.
- Member entry, membership, passes, settings, and recovery: consistent navy/white/emerald styling, phone-sized controls, and reduced decorative content above enrollment on mobile.
- Demo enrollment accurately says the access link is simulated and no text will be sent.

## Validation

TypeScript, ESLint, and whitespace checks pass. The dedicated local PostgreSQL cloud isolation verifier passes all checks, including the full recovery redemption and reset rollback. Browser inspection covered desktop Demo Studio, operator Today, and member enrollment at 390px, with document width equal to viewport width.

Hosted journey screenshots and final deployment/CI evidence are recorded in DEPLOYMENT_STATUS.md after deployment. The UI refresh does not change database migrations or domain contracts.
