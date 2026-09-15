"""Build the offline guide from the captured September 15 cloud walkthrough.
Requires reportlab and Pillow. These full-page captures have half-size content
in a padded canvas; the PDF frames that rendered region without editing PNGs.
"""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from PIL import Image
root=Path(__file__).resolve().parents[1]
shots=root/'docs/demo/screenshots/cloud-refresh'
pages=[
('01-landing.png','Open the demo','Go to pilot.upticklocal.com and choose Open demo. If asked, use the founder key in your private access file. Keep the same browser for the entire rehearsal.'),
('02-guided-studio.png','One step at a time','Choose a numbered step. Previous and Next move through the guide. Return to Demo Studio is available at the top of every demo screen.'),
('03-member-entry.png','1. Enter as a sample member','Use the prefilled fictional number and ZIP. Check the adult confirmation. Leave optional promotional texts unchecked. Choose Join Uptick.'),
('04-simulated-access.png','Open the simulated private link','No SMS is sent. Open the displayed private access link, then confirm Open Your Uptick. This is a fictional sample account.'),
('05-benefit.png','2. Claim the backed benefit','Your Uptick shows the sample weekly coffee benefit. Choose Claim this Uptick. The benefit is backed by this rehearsal’s separate sample stock.'),
('06-pass.png','Prepare the pass','Choose Use this pass at Uptick Tap. Then return to Demo Studio and choose step 3. Open the staff QR destination in the same browser.'),
('07-redemption.png','3. Record the digital redemption','At the sample staff destination, confirm the redemption. This records credential use. It does not prove purchase, physical handoff, or fulfillment.'),
('08-merchant.png','4. See the merchant result','Return to Demo Studio, choose step 4, then Open merchant view. The store sees its sample activity. These are synthetic records, not traction.'),
('09-operator.png','See the operator workspace','Open operator view from step 4. Overview gives three clear task choices. Weekly supply, Results, and Setup are separate screens.'),
('10-failure.png','5. Report a fulfillment failure','Return to step 5 and choose Report sample stockout. The scenario is coffee unavailable before physical handoff. The original digital evidence stays intact.'),
('11-recovery.png','6. Issue the backed recovery','Choose step 6 and Issue sample recovery. A sealed bottle of water uses separate sample fallback stock. Open the member’s pass and prepare it for Uptick Tap.'),
('12-recovery-redemption.png','Record the recovery','Return to step 3, open the staff QR destination, and record recovery redemption. The remedy serves the original obligation; it is not another member or paid placement.'),
('13-complete.png','Check the saved evidence','Open View saved sample activity. The completed rehearsal has one claim, original redemption, issue, recovery, and recovery redemption.'),
('14-reset.png','Reset and go again','Open Reset or finish this demo. Reset my rehearsal clears sample activity and rotates old sample links. End rehearsal & lock releases this browser’s session.'),
]
out=root/'output/pdf/uptick-cloud-demo-guide.pdf';out.parent.mkdir(parents=True,exist_ok=True)
import math,textwrap
sheets=[]
for filename,title,body in pages:
 im=Image.open(shots/filename);w,h=im.size
 scale=888/(w/2);dh=(h/2)*scale;dw=(w/2)*scale
 tiles=max(1,math.ceil(dh/508))
 for tile in range(tiles):sheets.append((im,title,body,scale,tile,tiles))
c=canvas.Canvas(str(out),pagesize=(960,720));c.setTitle('Uptick | Founder demo - refreshed cloud walkthrough')
for i,(im,title,body,scale,tile,tiles) in enumerate(sheets):
 c.setFillColor(HexColor('#f4f7fa'));c.rect(0,0,960,720,fill=1,stroke=0)
 c.setFillColor(HexColor('#087f68'));c.setFont('Helvetica-Bold',10);c.drawString(36,684,'UPTICK LOCAL  /  FOUNDER DEMO')
 c.setFillColor(HexColor('#142437'));c.setFont('Helvetica-Bold',25);c.drawString(36,644,title+(' - continued' if tile else ''))
 c.setFillColor(HexColor('#526579'));c.setFont('Helvetica',11)
 for j,line in enumerate(textwrap.wrap(body,135)):c.drawString(36,620-j*16,line)
 w,h=im.size;dw,dh=w*scale,h*scale
 c.saveState();clip=c.beginPath();clip.rect(36,64,888,508);c.clipPath(clip,stroke=0)
 c.drawImage(ImageReader(im),36,572-dh+tile*508,width=dw,height=dh)
 c.restoreState()
 c.setFillColor(HexColor('#637386'));c.setFont('Helvetica',8);c.drawString(36,28,'SAMPLE DATA ONLY  |  No real SMS or commercial commitments  |  Captured September 15, 2026')
 c.drawRightString(924,28,f'{i+1} / {len(sheets)}');c.showPage()
c.save();print(str(out)+' | '+str(len(sheets))+' pages')
