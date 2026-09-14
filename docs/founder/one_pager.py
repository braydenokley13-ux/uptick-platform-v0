import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_docx import *

G = os.environ.get("UPTICK_DOC_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "private", "founder"))
b = []
b.append(title("Help nearby people find your store"))
b.append(lead("You provide a useful perk. Uptick manages the member experience and reports the response."))
b.append(callout("A proposal for a bounded four-week test at one location. Not an active service at your store, and nothing is agreed until both sides confirm it in writing."))

b.append(h2("How it works"))
b.append(para("Uptick Local is a free membership for adults who live or work nearby. Members never pay and never have to buy anything to use the benefit they are offered. Each admitted member gets one featured, inventory-backed perk per week at a participating store. They show a pass at your counter; your staff presents the store's QR code to record it. If the item is out or the handoff fails, Uptick arranges a backed substitute rather than leaving the member — or you — to sort it out."))

b.append(h2("Who does what"))
b.append(table(
    ["You provide", "Uptick provides"],
    [
        ["One agreed item per week that is useful without a purchase, plus a substitute when it runs out.",
         "The membership, the weekly offer, reminders and member support."],
        ["A simple counter process your staff can follow, with a named manager and backup contact.",
         "Stock reserved against real commitments, so nobody is promised what you cannot supply."],
        ["Honest capacity: what you could truly honor if every reserved benefit is used.",
         "A record of what was issued, claimed and redeemed, reported back to you."],
        ["Agreement on the substitute and who funds a remedy if something fails.",
         "Failure handling and a documented remedy, with the payer agreed in advance."],
    ],
    [50, 50]))
b.append(note("Hosting a screen is optional. A supplier can contribute benefits without buying a paid program. You never receive an unrestricted member phone list."))

b.append(h2("The four-week pilot we would negotiate"))
b.append(table(
    ["Term", "To be agreed with you"],
    [
        ["Exact benefit", "[ITEM / SIZE]   ·   required member spend $0   ·   member fee $0"],
        ["Weekly quantity", "[UNITS PER WEEK], substitute [SUBSTITUTE ITEM], across four consecutive weeks"],
        ["Program fee", "[NEGOTIATED FEE] — there is no standard price; it is scoped to what is agreed"],
        ["Protection", "[NONE, OR EXPLICIT CATEGORY / RADIUS / DATES / EXCEPTIONS]"],
        ["Evaluation", "[WHAT WE WILL BOTH LOOK AT] / [RENEWAL DECISION DATE]"],
    ],
    [24, 76]))

b.append(h2("What we do not claim, and the next step"))
b.append(para("We do not guarantee traffic or sales, or that a redemption caused a visit. A recorded redemption means the process was used, not that a purchase happened. We do not promise a launch date before supply, staff, support and software are ready. Next step: confirm the item and substitute, your real unit cost, the weekly quantity you could honor and your staffed hours — then a short counter rehearsal."))

out = build(b, f"{G}/UPTICK_MERCHANT_ONE_PAGER.docx", os.path.join(G, "_build_one"),
            header_text="PILOT PROPOSAL",
            footer_text="Uptick Local  ·  [FOUNDER NAME]  ·  [CONTACT]  |  Discussion document, not an agreement  |  ")
pdf = to_pdf(out, G)
print(render(pdf, f"{G}/onepager"))
