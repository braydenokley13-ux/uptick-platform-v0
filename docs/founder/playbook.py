import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_docx import *

G = os.environ.get("UPTICK_DOC_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "private", "founder"))
b = []

# ---- Cover -------------------------------------------------------------
b.append(cover(
    "UPTICK LOCAL  ·  FOUNDER PLAYBOOK  ·  SEPTEMBER 2026",
    ["The operating", "playbook"],
    "How Uptick Local works, who pays for it, how to sell and run one honest four-week pilot, and what must never be promised.",
    ["Prepared September 14, 2026", "Internal — written to be used without reading the code"]))

b.append(panel("Read this first", [
    "This playbook describes a bounded pre-pilot service. The software is repaired and verified locally. No real member exists, enrollment is closed, and no real text message is sent.",
    "Everything marked [BRACKETS] is unconfirmed and must be filled from actual evidence, not assumption."], tone="caution"))

# ---- 01 What Uptick is -------------------------------------------------
b.append(sectionbar("01", "What Uptick is"))
b.append(h1("A free local membership, funded by the store"))
b.append(para("Uptick Local is a free membership for adults who live or work near a participating store. V1 destinations are gas stations attached to convenience stores. A member never pays and never has to buy anything to receive the benefit they are offered. Each admitted member is offered one featured, inventory-backed perk per week."))
b.append(stats([
    ("150", "target admitted members in a four-week cell"),
    ("200", "absolute member cap"),
    ("$0", "member cost and required purchase"),
    ("4", "weeks in one pilot"),
]))
b.append(table(["Who", "What they get", "What they give"], [
    ["Member", "One featured, no-purchase perk per week; support when something fails.", "Nothing. Promotional texts are optional and off by default."],
    ["Merchant", "Nearby people introduced to the store; a record of what was issued and redeemed.", "An agreed item and quantity, a counter process, and a negotiated fee where a paid program is agreed."],
    ["Supplier / partner", "Their product put in front of a local audience.", "Benefit supply, or distribution help. Neither requires buying a paid program."],
    ["Uptick", "A negotiated program fee where one is agreed.", "The membership, weekly release, verification, support, recovery and reporting."],
], [16, 44, 40]))
b.append(note("Buyer, funder, fulfiller, distribution partner and member stay distinguishable. No merchant receives an unrestricted member phone list or network-wide shopping history."))

# ---- 02 Journeys -------------------------------------------------------
b.append(sectionbar("02", "The four journeys"))
b.append(h1("What each person actually does"))
b.append(h2("The member"))
b.append(para("Joins on the web with a phone number, home ZIP and age confirmation. Promotional texts are a separate, unchecked choice. If admitted to a funded four-week cohort, they are shown one exact item, the store, the usable hours and when it expires. They claim it, show the pass at the counter, and staff presents the store's QR code to record it. If it fails, they report it and Uptick arranges a backed remedy."))
b.append(h2("The merchant"))
b.append(para("Agrees what the benefit is, how many per week, and the counter process. Sees the program they approved, the stock they owe, what was issued and redeemed, incidents and recovery, and fees or credits. They do not choose individual recipients and do not need to become a marketer."))
b.append(h2("The distribution partner"))
b.append(para("A residential building, employer or community contact who tells nearby people the membership exists. They commit to specific communication, not to handing over a resident list. Uptick never receives or asks for one."))
b.append(h2("The operator"))
b.append(para("Sets up the market and locations, drafts a run, records exact supply, readiness and fallback, commits four weeks, approves any paid program, admits members, freezes the cohort, reviews and releases each week, handles exceptions and recovery, and reconciles at the end."))

# ---- 03 Status ---------------------------------------------------------
b.append(sectionbar("03", "What is real today"))
b.append(h1("Status, dated and sourced"))
b.append(note("Status as of September 14, 2026, branch claude/keen-brown-wtdvht, commit 0b68859. Re-check before repeating any of this to a merchant."))
b.append(table(["Level", "What it means", "Where Uptick is"], [
    ["Implemented", "The behaviour exists in the code.", "Membership, admission, cohort freeze, weekly release, claim, staff-QR redemption, incidents, recovery, fallback, program approval, reconciliation."],
    ["Locally demonstrated", "Exercised against a real database on this machine.", "195 automated checks pass, including separate-session PostgreSQL contention, 150-member atomic release, and the recovery path."],
    ["Hosted demonstrated", "Proven on the hosted pilot domain.", "Not yet. Anonymous access checks only; authenticated hosted journeys are not commissioned."],
    ["Externally gated", "Blocked on a person, provider or store.", "Carrier messaging approval, real enrollment, physical counter rehearsal, store agreements, legal review."],
], [20, 32, 48]))
b.append(panel("The distinction that matters most", [
    "“Ready to demonstrate” is not “ready to launch.” The software can show the journey end to end. The pilot cannot start until supply, staff, support, messaging and hosting are actually ready."], tone="info"))

# ---- 04 Qualifying -----------------------------------------------------
b.append(sectionbar("04", "Qualifying a destination"))
b.append(h1("Who is worth a four-week commitment"))
b.append(twocol(
    "Qualifies", [
        "One person can commit the item, the fee and the staff instructions.",
        "A genuinely useful item can be given with no purchase.",
        "Trained staff during the hours the benefit is usable.",
        "Stock that can be replenished, and a named substitute.",
        "A manager and a backup who answer when something fails.",
    ],
    "Disqualifies", [
        "Nobody present can authorise anything.",
        "The owner insists on a fuel or spend requirement for the core benefit.",
        "No staffed hours that match the offer window.",
        "Capacity claimed but not evidenced; no substitute.",
        "No one accountable when the machine breaks or stock runs out.",
    ]))
b.append(para("Required evidence before any member is invited: the exact item and size, landed unit cost, weekly quantity that could be honored if every reserved benefit is used, staffed hours, the substitute, who funds a remedy, and a named manager and backup."))

# ---- 05 Commercial -----------------------------------------------------
b.append(sectionbar("05", "Selling and scoping"))
b.append(h1("Growth Program versus organic supply"))
b.append(table(["", "Paid Growth Program", "Organic supply"], [
    ["What it is", "A negotiated, operator-approved commercial program with an agreed scope and fee.", "A useful benefit contributed without buying a program."],
    ["Fee", "[NEGOTIATED] — there is no standard price.", "None."],
    ["What it buys", "Agreed placements within hard capacity ceilings, and where agreed, narrowly scoped protection.", "Participation. No guaranteed distribution."],
    ["What it never buys", "More than the cohort's real capacity, a member phone list, or a purchase requirement.", "Priority over paid obligations."],
], [16, 46, 38]))
b.append(panel("Do not invent a price", [
    "An earlier $200 figure was a suggestion, not an agreed or universal price. A free rehearsal is not evidence anyone will pay. Keep proposed price, agreed price, invoice, payment and benefit exposure separate at all times."], tone="caution"))
b.append(note("Hosting a screen is optional and is required for neither Growth nor supply. Protection, where agreed, is limited to an explicit category, radius of up to 1.5 straight-line miles, dates and exceptions. It never removes organic supply, issued obligations or member recovery."))

# ---- 06 Economics ------------------------------------------------------
b.append(sectionbar("06", "Economics worksheet"))
b.append(h1("Retail value is not cost; redemption is not profit"))
b.append(table(["Line", "How to fill it", "Your number"], [
    ["Program fee", "What was actually agreed, once per Program — not once per weekly Drop.", "[ ]"],
    ["Units committed", "Weekly quantity x 4 weeks.", "[ ]"],
    ["Direct unit cost", "Landed cost including cup, packaging, waste and handling. Not shelf price.", "[ ]"],
    ["Full-use exposure", "Units committed x direct unit cost. The worst case if every benefit is used.", "[ ]"],
    ["Uptick expense", "Messaging, hosting, tooling attributable to this cell.", "[ ]"],
    ["Recovery funding", "Held separately. Who pays for a remedy, and how much is set aside.", "[ ]"],
    ["Active labor", "Hours actually spent on setup, weekly release and exceptions.", "[ ]"],
    ["On-call labor", "Hours held available for failures, even when nothing fails.", "[ ]"],
], [22, 58, 20]))
b.append(note("At 150 members over four weeks the network promise is 600 member-weeks. That is not 600 benefits at one store, 600 visits, or 600 sales."))

# ---- 07 Partner --------------------------------------------------------
b.append(sectionbar("07", "Distribution partners"))
b.append(h1("Getting reach without buying a list"))
b.append(para("Approach a residential building manager, employer or community organiser with a specific, small ask: put the membership in a newsletter, on a noticeboard, or in a resident message on a named date. Record what they committed to and when it actually happened."))
b.append(twocol(
    "Ask for", [
        "A named communication on a named date.",
        "Permission to be described accurately to residents.",
        "A contact who confirms it went out.",
    ],
    "Never ask for", [
        "A resident list, phone numbers or email addresses.",
        "Consent on someone else's behalf.",
        "Exclusivity over a building's residents.",
    ]))

# ---- 08 Operating ------------------------------------------------------
b.append(sectionbar("08", "Running the pilot"))
b.append(h1("Setup, weekly rhythm, and the daily check"))
b.append(para("Setup order, each step depending only on what already exists: market and locations -> draft run -> exact supply, readiness and fallback -> four-week commitments -> Program approval where applicable -> partner commitments -> admission -> cohort freeze -> weekly review and release -> support and recovery -> reconciliation."))
b.append(weekstrip([
    ("Week 1", "First release. Watch first-use rate and whether staff recognise the pass."),
    ("Week 2", "Repeat behaviour appears. Recheck stock and staffing before releasing."),
    ("Week 3", "Supply fatigue shows up here. Repair the future plan, never the issued history."),
    ("Week 4", "Final release plus the renewal conversation. Reconcile money and labor."),
]))
b.append(h2("Before every weekly release"))
b.append(para("Reconfirm current stock (evidence no more than 72 hours old), staffed hours, the staff QR, and the fallback. Last week's readiness does not prove this week's."))
b.append(h2("Every morning"))
b.append(para("Work exceptions first: unresolved remedies, uncertain delivery, partner actions, stock and staffing changes. Decorative totals come last. Record actual operating time."))
b.append(h2("When something fails"))
b.append(para("Stop directing more people into the same unresolved problem. Contact the manager. Arrange a backed remedy and record who pays. A normal recovery target is seven usable days. Never turn a failed handoff into a recorded success."))

# ---- 09 Do not promise -------------------------------------------------
b.append(sectionbar("09", "Do not promise"))
b.append(h1("The nine sentences that would be untrue"))
b.append(panel("Never say any of these", [
    "“You will get more customers / more sales.” Guaranteed traffic or sales is not something Uptick can deliver or measure.",
    "“We already have members near you.” A 200-member cap is a configured ceiling, not an existing audience.",
    "“Unlimited exposure.” Audience, inventory and program ceilings are hard limits.",
    "“You'll be the only one.” Blanket exclusivity does not exist; protection is narrow and explicit.",
    "“We verify purchases.” A recorded redemption is not proof of a purchase or even of physical handoff.",
    "“We launch on [date].” No launch date before supply, staff, support, messaging and hosting are ready.",
    "“Fulfillment never fails.” It will. The plan is a backed remedy, not a claim of perfection.",
    "“Our lawyer approved this.” Not unless there is evidence of it.",
    "“The pilot is live.” It is not, until enrollment is actually opened under approval."], tone="caution"))

# ---- 10 Scorecard ------------------------------------------------------
b.append(sectionbar("10", "Scorecard"))
b.append(h1("Provisional targets, not benchmarks"))
b.append(stats([("50%", "first use — 75 of 150"), ("30%", "use in 2+ weeks — 45"), ("25%", "week-four use — 38")]))
b.append(para("These are management targets for judging whether the pilot is working, not proven benchmarks, sales guarantees or causal evidence. The cohort is fixed: disengaged members stay in the denominator and are never deleted to improve a rate."))
b.append(para("Also judge: were all admitted member-weeks actually backed by stock? Did the partner really distribute? Were failures repaired within the window? Would a merchant pay to continue? Could someone other than the founder run the cell? Does the business still work once benefits are used and labor is counted?"))
b.append(note("Record digital redemption separately from confirmed physical fulfillment. An unknown handoff is never counted as a success."))

# ---- 11 Week five ------------------------------------------------------
b.append(sectionbar("11", "Week five"))
b.append(h1("Continue, pause, or conclude — decide it out loud"))
b.append(table(["Decision", "What it requires", "What the member sees"], [
    ["Continue, funded", "A renewed commercial agreement and confirmed supply for the next period.", "An unbroken weekly rhythm."],
    ["Controlled pause", "An explicit decision to stop releasing while membership persists.", "A clear message that there is no benefit this week and why."],
    ["Conclude", "Reconciliation finished and obligations closed out.", "An honest ending, not silence."],
], [22, 46, 32]))
b.append(panel("The failure to avoid", "Letting the fourth week pass with no decision. A silent broken weekly promise costs more trust than an honest pause, and duplicate membership on a restart is worse still.", tone="caution"))

# ---- 12 Action list ----------------------------------------------------
b.append(sectionbar("12", "Founder action list"))
b.append(h1("Open items that only a person can close"))
b.append(table(["Action", "Owner", "Evidence needed to close"], [
    ["Confirm the station, owner name and authority", "Founder", "Who signs, who instructs staff"],
    ["Agree the exact item, substitute and landed cost", "Founder + owner", "Written confirmation of item, size, cost"],
    ["Establish weekly capacity and staffed hours", "Owner", "A number the store can honor at full use"],
    ["Run the counter rehearsal", "Founder + manager", "Staff recognise the pass and present the QR"],
    ["Negotiate the program fee and scope", "Founder + owner", "Proposed vs agreed, in writing"],
    ["Commission the hosted service", "Technical owner", "Successful authenticated hosted journey"],
    ["Carrier messaging approval", "Technical owner + provider", "Approved sender, before any real SMS"],
    ["Legal and policy review", "Founder + counsel", "Actual review; never assume it happened"],
    ["Recruit a distribution partner", "Founder", "A named communication on a named date"],
], [34, 24, 42]))
b.append(note("Uptick Local founder playbook. Prepared September 14, 2026 against commit 0b68859. Status statements expire — re-verify before quoting them to anyone."))

out = build(b, f"{G}/UPTICK_FOUNDER_PLAYBOOK.docx", os.path.join(G, "_build_play"),
            header_text="FOUNDER PLAYBOOK",
            footer_text="Internal | Uptick Local founder playbook | September 14, 2026 | ")
pdf = to_pdf(out, G)
print(render(pdf, f"{G}/play"))
