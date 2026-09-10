# Uptick Tap: operator setup and verification

Uptick Tap connects a private pass to a permanent store redemption point. Create the point at `/operator/tap`. A location QR works across different Drops; do not print a new redemption QR each week.

## First, set up the cashier’s counter

1. Select the actual merchant and store. Name the point, for example “Counter 01.”
2. Choose staff access for offers with a qualifying condition. The cashier checks the condition before presenting the sign. Public access is intended for approved no-purchase offers.
3. Create the point. Download its QR image or print the page. Installing and testing the physical sign remain operator tasks; saving the point does not claim installation.
4. Give the staff the current Drop’s qualifying condition, reward, quantity, operating window, fallback plan and instructions.
5. On the customer’s phone, open the private pass and select it for the visit. That action saves an encrypted HttpOnly pairing cookie. Tap or scan the store sign, then explicitly confirm redemption.
6. Wait for the green UPTICK REDEEMED screen with the correct store, reward and time. Give the reward once.

Opening the Tap URL does not consume a pass or an NFC counter. A successful POST atomically validates the private claim, store, point, policy, dates, reservation deadline and remaining supply. It records immutable redemption evidence. Duplicate requests return the original result. An expired reservation cannot be revived. Pausing new supply or opting out of membership does not revoke a previously issued valid promise.

## Evidence language

| Evidence           | Level | What it supports                                                                             |
| ------------------ | ----- | -------------------------------------------------------------------------------------------- |
| Self-confirmation  | 0     | Member says the redemption happened; only operator-approved low-risk supply permits this.    |
| Operator override  | 0     | Authenticated operator recorded an exception with a reason. Expiry and quantity still apply. |
| Static location QR | 1     | The correct store credential was used. A static QR is copyable.                              |
| Secure NFC         | 2     | The tag authentication and advancing read counter were accepted.                             |

Staff-gated access is a separate field describing the configured operating policy. It does **not** prove that a cashier actually checked a receipt. `transaction_verified` is always false. POS and rotating QR are future adapter types and are not represented as working integrations.

## Secure NFC software contract

The adapter supports one explicit NTAG 424 DNA AES SDM profile: encrypted PICC data with seven-byte UID and three-byte read counter, using `SDMMACInputOffset == SDMMACOffset`. The server decrypts PICC data with AES-CBC, derives the session MAC key using AES-CMAC, verifies the truncated MAC in constant time and checks the provisioned UID. Counter bytes are interpreted least-significant first. This matches the published example in [NXP AN12196, sections 3.3 and 3.4](https://www.nxp.com/docs/en/application-note/AN12196.pdf). Tests also check independent [NIST CMAC examples](https://csrc.nist.gov/csrc/media/projects/cryptographic-standards-and-guidelines/documents/examples/aes_cmac.pdf).

The provisioning identifier is `ntag424-encrypted-picc-empty-mac-v1`. Other tag profiles are rejected; they must not be assumed compatible.

1. Have the responsible technical operator prepare and securely program an NTAG 424 DNA tag with this profile. Use the manufacturer’s current tooling and instructions. Do not expose factory/default keys.
2. Store two tag-specific 128-bit AES keys as 32 hexadecimal characters in your server secret manager. Names must begin with `UPTICK_NFC_KEY_`, for example `UPTICK_NFC_KEY_STORE01_META` and `UPTICK_NFC_KEY_STORE01_READ`. Use dedicated, independently generated keys; never reuse application session, pass-encryption or Twilio secrets. No example production secrets are supplied.
3. At `/operator/tap`, enter the tag UID and the **names** of those two server keys. The web form never accepts secret values. Zero factory keys and missing key references fail closed.
4. Program the exact URL template shown by the operator page: `/tap/<credential>?e=<32-hex-encrypted-PICC>&c=<16-hex-MAC>`. Configure offsets for the encoded NDEF file; URL character counts alone are not a provisioning guide.
5. Verify several physical reads on supported phones, QR fallback, redemption, duplicate requests, replay rejection, revocation and replacement in the isolated staging environment before installing a live sign. Check fresh authentication after the tag has been read without completing redemption.
6. Document hardware identity, installation, key custody, recovery access and staff training in your operating records. This app does not program hardware or certify a tag installation.

The database stores key references, public tag metadata and the counter high-water mark. It never stores NFC key bytes. Keep old version references immutable. Rotate by adding new server secret references and replacing the credential; do not silently overwrite an existing reference with an unrelated key. A replacement URL for the same UID carries forward the prior accepted counter. A counter reset or wrap requires a replacement tag with a new UID. Revoked points and credentials cannot be reactivated.

Replay protection rejects counters already accepted by the server. It does not prove that a customer is physically present, prevent every relay attack, or cryptographically prove the cashier’s visual check. Secure NFC evidence is stronger than static QR evidence but is not a digitally verified transaction.

## Rehearsal and current limits

The operator’s software rehearsal writes only `tap_test_events`. It creates no production claim, redemption, demand event or accepted tag counter. The NXP scenario executes the published cryptographic vector. QR, wrong-store and revoked scenarios execute the same point-policy checks used by redemption with isolated inputs. The replay scenario verifies the NXP proof and passes an already-seen counter through the real replay guard. Full transactional behavior is separately exercised by database tests.

`tests/tap.test.ts` covers independent cryptographic vectors, wrong-location and staff-access rejection, immutable records, credential replacement, counter replay under contention, same-UID rotation, duplicate redemption, final quantity contention, expiry, replenishment, permission checks and test isolation. The real PostgreSQL verification harness exercises cross-connection contention separately.

No physical NFC hardware has been programmed or verified in this build. Live deployment still needs actual tags, secure key provisioning, phone and cashier testing, HTTPS, deployment log redaction and an operating recovery process. The app suppresses Tap URL logging in Next; hosting/proxy logs must also redact the dynamic query and private pass paths.
