# Founder demo — start here

This demo runs the real Uptick application on your laptop, using a separate sample database. It sends no real SMS and creates no hosted members, real inventory obligations or commercial commitments.

## 1. Launch it

1. Open **Terminal** on your Mac. You can find it using Spotlight: press Command-Space, type Terminal, then press Return.
2. Copy this line into Terminal and press Return. It selects the Uptick project folder:

   ```sh
   cd /Users/braydenwhite/Desktop/uptick-platform-v0
   ```

3. Run this command and wait for it to finish. It creates a fresh sample rehearsal:

   ```sh
   npm run demo:reset
   ```

4. Run this command and leave that Terminal window open:

   ```sh
   npm run demo
   ```

5. Wait for **Ready**, then open [Demo Studio](http://127.0.0.1:3210/demo) in your browser. Keep using the same browser throughout the demo. Every relevant screen has **DEMO · SAMPLE DATA · NO REAL SMS** at the top.

Node 22.13 or newer and the repository dependencies are needed. They are installed on this laptop. On a new checkout, run `npm ci` once before these steps. No environment-file editing is needed for Demo Studio.

## 2. Show the full story

Scroll down when a button is below the visible screen. **Return to Demo Studio** is always in the top banner.

| Step | What you do                                                                                                  | What should happen                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | In Studio, click **Open member journey**.                                                                    | Join opens with sample phone `(202) 555-0123` and ZIP `10583`. Use these fictional values.                                                                            |
| 2    | Check the adult membership box. Leave promotional texts unchecked. Click **Join Uptick — it’s free**.        | A clearly simulated access response says that no text was sent.                                                                                                       |
| 3    | Click **Open my Uptick**, then **Join & open my Uptick**.                                                    | The private link confirms the sample membership. Simply viewing the link does not confirm it.                                                                         |
| 4    | On **Your Uptick**, inspect the coffee benefit. Click **Claim this Uptick**.                                 | A private pass shows one free 12 oz coffee at Sample Fuel & Market, with no purchase required.                                                                        |
| 5    | On the pass, click **Use this pass at Uptick Tap**.                                                          | The browser prepares that pass for the store credential.                                                                                                              |
| 6    | Return to Studio. Click **Open staff QR destination**.                                                       | This follows the exact destination encoded in the sample QR. On one laptop it stands in for scanning the cashier’s QR.                                                |
| 7    | Click **Confirm & redeem at this counter**.                                                                  | A saved redemption and timestamp appear.                                                                                                                              |
| 8    | Return to Studio. Click **Open merchant view**.                                                              | Results show one issued placement, one claim and one recorded redemption, without member identities.                                                                  |
| 9    | Return to Studio. Click **Report sample stockout**.                                                          | The sample incident is recorded after the digital redemption but before physical handoff. The original evidence remains.                                              |
| 10   | Click **Issue sample recovery**. Then click **Return to the member’s pass →**.                               | A separate sealed bottle of water is offered as recovery for the original obligation.                                                                                 |
| 11   | Open the recovery pass. Click **Use this pass at Uptick Tap**. Return to Studio and open the staff QR again. | The counter now verifies the recovery item.                                                                                                                           |
| 12   | Confirm redemption. Return to **Your Uptick**.                                                               | Recovery shows redeemed; the original coffee redemption remains in history.                                                                                           |
| 13   | Return to Studio and inspect **Saved sample evidence**. Open **Operator view → Fulfillment**.                | Studio shows `1 / 1 / 1 / 1 / 1`: claim, original redemption, incident, recovery, recovery redemption. The operator sees the preserved obligation and remedy history. |

Expected sample setup: one four-week pilot, one prepared sample member, one gas/convenience-store destination, four weeks of coffee supply, separate bottled-water fallback, a sample merchant/operator and a staff QR. No real phone is needed. Sample dates are generated from the current week when you reset.

## 3. Stop or start over

1. Go to the Terminal window running the demo.
2. Hold Control and press C. Wait for the command prompt to return.
3. Run `npm run demo:reset`.
4. Run `npm run demo` and reopen Studio.

Reset removes only the owned `.demo-studio/database` and its signing keys. It does not remove `.data`, edit `.env` files or connect to Supabase. Old sample links stop working. Open a new member journey after reset rather than reusing a bookmarked private pass.

## 4. If something interrupts the meeting

- **Port in use:** stop the prior demo with Control-C, then launch again. Do not run two demo processes together.
- **Hosted settings rejected:** open a normal new Terminal window without exported database/provider settings. The refusal is intentional; do not disable it.
- **Old pass, expired week or interrupted action:** return to Studio and inspect the saved counts before repeating an action. For a fresh meeting, stop/reset/launch.
- **Browser cannot connect:** confirm Terminal is still running and the URL is exactly `http://127.0.0.1:3210/demo`. Reopen that address in a normal browser tab.
- **No time to troubleshoot:** open `output/pdf/uptick-founder-demo.pdf`. It contains the full recorded journey, including merchant results, failure, recovery and preserved evidence. Screenshots are in `docs/demo/screenshots/final/`. These files work with the server stopped and without an internet connection.

## 5. What to say

“This is the real product running on isolated sample data. A member gets a backed free weekly benefit. The store presents a QR, Uptick records its use, and the operator can repair a fulfillment failure without erasing the original record.”

Say **recorded redemption**, not purchase proof, guaranteed physical handoff or incremental sales. The sample counts are a software demonstration, not traction. The demo does not mean real enrollment is open. See [the current release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md) for the six separate verdicts.
