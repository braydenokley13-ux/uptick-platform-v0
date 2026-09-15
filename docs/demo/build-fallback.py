"""Build the offline founder walkthrough from verified application captures."""
from pathlib import Path
from xml.sax.saxutils import escape
from fontTools.ttLib import TTFont as SourceFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

ROOT = Path(__file__).resolve().parents[2]
TMP = ROOT / 'tmp/pdfs'
TMP.mkdir(parents=True, exist_ok=True)
OUT = ROOT / 'output/pdf/uptick-founder-demo.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
for name, source in [
    ('Geist', 'geist-sans/geist-sans-latin-400-normal'),
    ('GeistBold', 'geist-sans/geist-sans-latin-600-normal'),
    ('Newsreader', 'newsreader/newsreader-latin-500-normal'),
]:
    package, filename = source.split('/')
    font = SourceFont(ROOT / 'node_modules/@fontsource' / package / 'files' / (filename + '.woff'))
    font.flavor = None
    target = TMP / (name + '.ttf')
    if 'CFF ' in font:
        # ReportLab needs TrueType outlines. Convert the bundled cubic font
        # curves into quadratic outlines, retaining its character map/metrics.
        source_glyphs = font.getGlyphSet()
        glyphs = {}
        for glyph_name in font.getGlyphOrder():
            pen = TTGlyphPen(source_glyphs)
            source_glyphs[glyph_name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
            glyphs[glyph_name] = pen.glyph()
        builder = FontBuilder(font['head'].unitsPerEm, isTTF=True)
        builder.setupGlyphOrder(font.getGlyphOrder())
        builder.setupCharacterMap(font.getBestCmap())
        builder.setupGlyf(glyphs)
        builder.setupHorizontalMetrics(font['hmtx'].metrics)
        builder.setupHorizontalHeader(ascent=font['hhea'].ascent, descent=font['hhea'].descent)
        builder.setupNameTable({'familyName': name, 'styleName': 'Regular', 'uniqueFontIdentifier': name, 'fullName': name, 'psName': name})
        builder.setupOS2(sTypoAscender=font['OS/2'].sTypoAscender, sTypoDescender=font['OS/2'].sTypoDescender, usWinAscent=font['OS/2'].usWinAscent, usWinDescent=font['OS/2'].usWinDescent)
        builder.setupPost()
        builder.save(target)
    else:
        font.save(target)
    pdfmetrics.registerFont(TTFont(name, str(target)))

W, H = 1000, 650
MARINE, CANVAS, PAPER, MINT, AMBER = map(HexColor, ['#0a1820','#f3f0e9','#faf8f4','#5fd6bb','#e2a24f'])
c = canvas.Canvas(str(OUT), pagesize=(W,H), pageCompression=1)
c.setTitle('Uptick — Founder demo, complete offline walkthrough')
c.setAuthor('Uptick Local')
c.setSubject('Isolated sample application journey. No real SMS or commercial obligations.')
page_no = 0

def para(text, x, top, width, size=13, color=MARINE, font='Geist'):
    p = Paragraph(text, ParagraphStyle('p', fontName=font, fontSize=size, leading=size*1.4, textColor=color))
    _, height = p.wrap(width, H)
    p.drawOn(c, x, top-height)
    return top-height

def base(label):
    global page_no
    page_no += 1
    c.setFillColor(CANVAS); c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(MARINE); c.setFont('Newsreader',25); c.drawString(36,H-39,'uptick')
    c.setFont('GeistBold',9); c.drawRightString(W-36,H-30,'DEMO  /  SAMPLE DATA  /  NO REAL SMS')
    c.setStrokeColor(MINT); c.setLineWidth(2); c.line(36,H-50,W-36,H-50)
    c.setFillColor(MARINE); c.setFont('Geist',9)
    c.drawString(36,20,label)
    c.drawRightString(W-36,20,f'{page_no:02d}  /  UPTICK FOUNDER REHEARSAL')

def screenshot(path, x, y, width, height):
    if not path.exists(): raise FileNotFoundError(path)
    c.setFillColor(PAPER); c.roundRect(x-3,y-3,width+6,height+6,7,fill=1,stroke=0)
    c.drawImage(str(path),x,y,width=width,height=height,preserveAspectRatio=True,anchor='c',mask='auto')

base('Offline walkthrough · captured September 15, 2026')
para('A little good.<br/>The whole journey.',36,555,680,48,font='Newsreader')
para('A founder-operated demo of the real Uptick application.',39,408,650,20)
para('Member entry → backed benefit → claim → staff QR → recorded redemption → merchant result → fulfillment failure → recovery.',39,348,860,19)
c.setFillColor(MARINE); c.roundRect(36,105,928,150,16,fill=1,stroke=0)
para('ONE ORIGINAL OBLIGATION. PRESERVED EVIDENCE.',58,232,870,12,MINT,'GeistBold')
para('The recorded sample journey ends with 1 claim, 1 original redemption, 1 incident, 1 recovery and 1 recovery redemption.',58,198,866,20,PAPER)
para('These are synthetic records. No hosted members, real SMS, live inventory or commercial commitments were created.',39,72,900,11)
c.showPage()

base('Launch and reset · no SQL, hidden IDs or environment edits')
para('Run it yourself.',36,569,900,36,font='Newsreader')
y=504
for number,title,body in [
('1','Open Terminal','Press Command-Space, type Terminal and press Return. Select the project folder using the command below.'),
('2','Create a fresh rehearsal','Run npm run demo:reset and wait for it to finish. Run npm run demo and leave Terminal open.'),
('3','Open Demo Studio','Visit http://127.0.0.1:3210/demo. Use the buttons in order and stay in the same browser. Sample phone: (202) 555-0123; ZIP: 10583.'),
('4','Stop or start over','In the running Terminal, press Control-C. Run demo:reset, then demo again. Open a fresh member journey; old sample links stop working.')]:
    c.setFillColor(MINT); c.circle(53,y-13,17,fill=1,stroke=0)
    c.setFillColor(MARINE); c.setFont('GeistBold',14); c.drawCentredString(53,y-18,number)
    para(title,84,y,820,17,font='GeistBold')
    para(body,84,y-29,820,13)
    y-=98
c.setFillColor(PAPER); c.roundRect(36,57,928,50,8,fill=1,stroke=0)
para('cd /Users/braydenwhite/Desktop/uptick-platform-v0',52,91,890,13,font='GeistBold')
para('If the live demo is unavailable, continue through this PDF. Every following image is a real application capture.',38,44,920,9)
c.showPage()

scenes=[
('01-studio','Start in Demo Studio','The launcher creates an isolated four-week sample pilot. The top banner labels the environment on every relevant screen.'),
('02-entry','Enter the member journey','Use the fictional sample phone and ZIP. No real phone number is needed to demonstrate the membership flow.'),
('03-entry-form','Make the membership choice','Confirm the adult membership box. Promotional SMS is optional and starts unchecked. Declining it does not block this journey.'),
('04-simulated-access','Open simulated access','The response says no text was sent. Open my Uptick provides the local one-time access step.'),
('05-confirm-membership','Confirm deliberately','Click Join & open my Uptick. Merely loading this private access page changes nothing.'),
('06-backed-benefit','See the exact weekly benefit','One free 12 oz coffee at Sample Fuel & Market. No purchase or member payment is required. Claim this Uptick opens a private pass.'),
('07-claimed-pass','Prepare the claimed pass','Click Use this pass at Uptick Tap. This pairs the saved pass with the staff-presented store credential in this browser.'),
('08-staff-qr','Verify at the sample counter','Return to Studio and open the staff QR destination. On one laptop this follows the exact QR URL instead of scanning it with a second device.'),
('09-recorded-redemption','Record redemption','Confirm & redeem at this counter saves the digital event. The result records use of the QR credential; it does not establish purchase or physical handoff.'),
('10-merchant-results','Show truthful merchant results','The merchant sees one issued placement, one claim and one recorded redemption, without member phone lists or invented sales metrics.'),
('11-incident-recorded','Report a fulfillment failure','The sample coffee runs out before handoff. Report sample stockout records the incident while preserving the original digital redemption.'),
('12-recovery-available','Offer a backed recovery','Issue sample recovery reserves separate bottled-water fallback. Your Uptick shows the remedy alongside the original benefit history.'),
('13-recovery-pass','Keep the original evidence','The same private pass shows the bottled-water recovery and the original recorded coffee redemption. Prepare this pass for Tap again.'),
('14-recovery-qr','Verify the recovery item','Open the same staff QR destination. Confirm the sealed bottle of water, with no purchase or member fee.'),
('15-recovery-recorded','Finish recovery','The member sees Status: redeemed for the remedy. The original coffee redemption remains visible. This serves one original obligation.'),
('16-complete-ledger','Review the complete ledger','The saved sample counts are exactly 1 / 1 / 1 / 1 / 1. A recovery is neither a second member nor another paid acquisition.'),
('17-operator-recovery','Inspect remedy history','The operator sees the current redeemed remedy and the preserved history. Further failures use an explicit superseding remedy, never an edited original record.'),
('18-operator-overview','Separate demo from launch','The sample operator overview keeps real launch checks visible. A working demonstration is not proof of provider approval or real Market Cell readiness.')
]
for stem,title,body in scenes:
    base('Verified application capture · sample records only')
    para(title,36,577,925,29,font='Newsreader')
    para(body,37,540,920,12)
    screenshot(ROOT/'docs/demo/screenshots/final'/f'{stem}-desktop.png',36,48,638,443.06)
    screenshot(ROOT/'docs/demo/screenshots/final'/f'{stem}-mobile.png',756,48,205,443.64)
    c.showPage()

base('Meeting language and next steps')
para('Show what the evidence says.',36,570,910,35,font='Newsreader')
y=504
for title,body in [
('What this demonstrates','The real member, merchant and operator flows work together on isolated sample data. The original obligation and recovery history remain distinct.'),
('What the counts mean','A claim is a saved benefit. A QR redemption is recorded credential use. Neither proves a purchase, a physical handoff or incremental sales. The sample counts are not traction.'),
('Before real members','Commission the exact release and migrations, hosted authentication and recovery, Twilio and signed callbacks, approved policies, support coverage and a real four-week backed Market Cell. Keep enrollment closed until those checks are complete.'),
('Where to continue','docs/DEMO_RUNBOOK.md is the step-by-step launch guide. docs/REAL_ENROLLMENT_RELEASE_TRUTH.md holds the separate current verdicts. docs/REAL_ENROLLMENT_RUNBOOK.md orders the external commissioning work.')]:
    para(title,37,y,914,17,font='GeistBold')
    para(body,37,y-29,914,13)
    y-=113
c.showPage(); c.save()
print(f'Created {OUT} ({page_no} pages)')
