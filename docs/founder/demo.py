import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_docx import *

G = os.environ.get("UPTICK_DOC_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "private", "founder"))
b = []
b.append(cover(
    "UPTICK LOCAL  ·  THURSDAY DEMO KIT  ·  SEPTEMBER 17, 2026",
    ["The rehearsal", "you can show"],
    "A deterministic local demonstration using synthetic data, with a spoken walkthrough and an offline fallback.",
    ["Prepared September 14, 2026 against commit 0b68859",
     "Synthetic data only — no real member, no real message, no live liability"]))

b.append(panel("What this is and is not", [
    "This runs the real application against a real database, seeded with clearly synthetic sample data. Every journey shown is genuinely implemented and covered by automated checks.",
    "It is not the hosted public service. pilot.upticklocal.com is not commissioned for authenticated journeys, so demonstrate locally and say so plainly."], tone="caution"))

b.append(sectionbar("01", "Before the meeting"))
b.append(h1("Set it up the night before, not in the car"))
b.append(para("These commands were run and verified on September 14, 2026. Run them once on the machine you will actually bring, and leave the server running."))
b.append(table(["Step", "Command", "What you should see"], [
    ["1. Install", "npm ci", "Dependencies install with no errors."],
    ["2. Build", "npm run build", "A production build completes."],
    ["3. Seed", 'LOCAL_DATABASE_PATH=/private/tmp/uptick-browser-rehearsal-demo \\\nUPTICK_ENV=development UPTICK_LOCAL_MODE=true \\\nSMS_TRANSPORT=development \\\nnode --import tsx scripts/seed-browser-rehearsal.ts',
     '"Created isolated synthetic browser rehearsal: 3 members; no issued grants; no real SMS."'],
    ["4. Start", "npm run start   (same environment variables)", "Ready on http://127.0.0.1:3000"],
    ["5. Check", "Open http://127.0.0.1:3000/join", "The member page loads with a LOCAL PILOT · SAMPLE PLACES · NO REAL SMS banner."],
], [16, 46, 38]))
b.append(panel("Safety rails that must stay on", [
    "The seeder refuses to run against a hosted database or the saved local one. SMS_TRANSPORT=development means nothing is ever sent to a carrier. Never add an authentication bypass to make a demo convenient."], tone="info"))

b.append(sectionbar("02", "The walkthrough"))
b.append(h1("Three to five minutes, in this order"))
b.append(note("The suggested length is a presentation format. It says nothing about how long the work took."))
b.append(table(["#", "Show", "Say, roughly"], [
    ["1", "The member join page at /join, on a phone-sized window.",
     "“This is what a neighbour sees. Free to join, no app. The promotional-text box is separate and off unless they tick it — declining it never removes their membership or a benefit they were promised.”"],
    ["2", "The weekly benefit: one exact item, the store, usable hours, expiry.",
     "“One featured perk per week. No purchase required, no member payment. The stock behind it is reserved, so we are not promising something the store cannot supply.”"],
    ["3", "The claim, then the staff-presented QR at the counter.",
     "“The member claims it, your cashier presents the store's code. That records the redemption — it does not prove the item was physically handed over, and we never report it as if it did.”"],
    ["4", "A failure: report a stockout, then the backed recovery.",
     "“This is the part most programs skip. When it fails we keep the original attempt visible, arrange a substitute at an independently ready destination, and record who pays for it.”"],
    ["5", "The operator exception view.",
     "“Every morning this is what gets worked first: unresolved remedies, uncertain delivery, stock and staffing changes — before any totals.”"],
    ["6", "The merchant view.",
     "“What you approved, what you owe in stock, what was issued and redeemed, incidents, and fees. No member phone list, ever.”"],
], [6, 32, 62]))

b.append(sectionbar("03", "If the demo fails"))
b.append(h1("The fallback, and how to use it without overclaiming"))
b.append(para("Bring the captured screenshots supplied alongside this kit: the member join page at desktop and phone width, taken from the verified build on September 14, 2026. Walk the same six steps against the images."))
b.append(twocol(
    "Safe to say while showing images", [
        "“These are captured from the build we verified.”",
        "“This is sample data, not a real member.”",
        "“The journey is implemented and tested; the hosted public service is not commissioned yet.”",
    ],
    "Never say", [
        "“This is live.”",
        "“These are our members.”",
        "“You can sign up today.”",
    ]))
b.append(panel("Never fake a screen", "Do not mock up a screen for a feature that does not exist and present it as working. If something is not built, say it is not built.", tone="caution"))

b.append(sectionbar("04", "What was verified"))
b.append(h1("So you can answer “does it actually work?” honestly"))
b.append(stats([("195", "automated checks passing"), ("0", "failing checks"), ("150", "member atomic release, real PostgreSQL")]))
b.append(table(["Checked", "Result"], [
    ["Unit and database suite (npm test)", "195 passed, 0 failed"],
    ["Separate-session PostgreSQL contention, isolated cluster", "Passed, including 150 synthetic grants under competing sessions"],
    ["Lock order under adversarial interleaving", "The opposing order deadlocks; the shared order does not"],
    ["Production build", "Passed"],
    ["Member page at 390px phone width", "Renders with zero horizontal overflow"],
    ["Hosted authenticated journeys", "Not commissioned — do not demonstrate as live"],
    ["Real carrier SMS, real members, counter rehearsal", "Deliberately not performed"],
], [58, 42]))
b.append(note("Uptick Local Thursday demo kit. Prepared September 14, 2026 against branch claude/keen-brown-wtdvht, commit 0b68859. Re-verify before reusing these statements."))

out = build(b, f"{G}/UPTICK_THURSDAY_DEMO.docx", os.path.join(G, "_build_demo"),
            header_text="THURSDAY DEMO KIT",
            footer_text="Internal | Rehearsal, synthetic data | September 14, 2026 | ")
pdf = to_pdf(out, G)
print(render(pdf, f"{G}/demo"))
