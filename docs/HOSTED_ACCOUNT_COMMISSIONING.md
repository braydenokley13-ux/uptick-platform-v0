# Hosted account security and recovery

Status: software implementation in the real-enrollment branch; hosted rehearsal **not yet proved**. These controls do not enable enrollment or send SMS.

## What is implemented

1. `/login` checks the password with Supabase and confirms an Uptick business assignment. It then opens `/account/security`.
2. The security screen lets the account owner name and enroll a TOTP authenticator, scan its QR code, verify it, choose a primary or backup factor, and remove a factor while keeping another verified factor.
3. A password-only session cannot add or verify a new factor when a verified factor already exists. It must prove an existing factor first. An enrolled factor is enforced for both merchant and operator business access. `OPERATOR_MFA_REQUIRED=true` additionally requires factor setup for an operator with no factor.
4. Account setup remains reachable while business access is blocked. Recovery-only sessions cannot open business pages or select a staging persona.
5. `/account/recovery` requests a Supabase recovery email. The response does not reveal whether the email exists. Each PKCE verifier is encrypted in an HttpOnly, Secure, SameSite cookie for fifteen minutes. The recovery email must be opened in the same browser. An explicit button exchanges the code; opening the page alone does not do so.
6. Password recovery requires an existing authenticator if one is enrolled. After the new password is accepted, all existing Uptick account sessions are revoked and provider global logout is requested.
7. Logout records immediate application revocation before provider logout. A copied cookie cannot regain access when a temporarily unavailable provider returns. Application and provider logout outcomes are reported separately.
8. The owner can sign out other sessions. Operators can assign verified accounts by email and remove all business access for another account. Removing access also revokes its current Uptick sessions. Operators cannot remove or change their own access through these controls.
9. Every hosted account request validates its token with Supabase, checks the exact `auth.sessions` record, and rejects application-revoked sessions. Authenticator secrets, passwords, tokens and private recovery links do not appear in the application audit ledger.

## Before the first rehearsal

Keep real enrollment and real message delivery disabled throughout this procedure. Use authorized internal operator and merchant accounts. Do not create member or commercial records to test authentication.

1. Review and release the branch through the release runbook, with its complete migration set. Account revocation needs migration `029_account_session_revocation.sql`; a deployed source whose database lacks it will fail closed.
2. In Supabase Auth URL Configuration, set the Site URL to the canonical application URL and allow `https://pilot.upticklocal.com/account/recovery` plus the narrowly scoped `https://pilot.upticklocal.com/account/recovery?sb_flow_id=*` recovery redirect. Avoid broad wildcard production redirects.
3. Confirm the project's configured recovery-email template follows Supabase's PKCE recovery redirect. The pinned SDK is configured to append `sb_flow_id` so multiple pending links use their own verifier; preserve that query parameter when forwarding the callback. Do not replace the link with an unrelated magic-link or sign-up flow.
4. Configure an approved email sender and the monitored internal mailbox. Record sender identity, SMTP configuration owner, and the observed delivery result. A successful reset-request response does not prove email delivery.
5. Review the project's password policy, email confirmation requirement, token lifetime, rate limits and leaked-password protection. Save the actual settings as evidence; do not infer them from a green deployment.
6. Confirm the server database role can read `auth.users`, `auth.sessions` and non-secret factor metadata in `auth.mfa_factors`. The browser receives none of that database access. These columns were confirmed present with a read-only schema check during this implementation; privileges and positive requests still require rehearsal.
7. Confirm `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_URL`, `SESSION_SECRET` and `PASS_ENCRYPTION_KEY` refer to the intended environment. Keep secret values out of screenshots and reports.
8. Leave `OPERATOR_MFA_REQUIRED=false` until primary and backup operator setup and recovery have been exercised. Enable enforcement before considering real enrollment.

## Primary operator: click-by-click

1. Open the canonical host, then **Sign in**.
2. Enter the operator email and password. Choose **Sign in**.
3. On **Account security**, give the first authenticator a recognizable name, such as “Primary phone”. Choose **Start setup**.
4. Open your authenticator app. Add a new account and scan the QR code. If scanning is unavailable, expand the manual setup key and enter it in the authenticator app. Keep this screen private.
5. Enter the current six-digit code, then choose **Verify and save authenticator**.
6. Add a backup authenticator controlled separately from the primary device. Verify it. Do not photograph its secret into the commissioning evidence.
7. Choose **Open business workspace**. Confirm the correct operator workspace appears.
8. Open **Account security** again and sign out. Sign back in. Select each verified authenticator in separate sign-in attempts and prove each can finish verification.
9. Try an incorrect code. Confirm business access remains blocked and retrying with the correct current code succeeds.

## Backup operator and merchant

1. In the connected Supabase Auth dashboard, create the authorized backup operator account and complete email verification. This is an external account-owner action; no SQL is needed.
2. In Uptick, open **Pilot settings → Manage operator and merchant access**.
3. Enter the verified email, choose the business, and choose the intended role. An operator role provides platform-wide operating access; a merchant role is scoped to the selected business.
4. Have the backup operator independently repeat primary/backup authenticator setup and login. Record who controls recovery without recording secrets.
5. Assign an internal merchant account to one business. Sign in as that merchant, confirm its business appears, and prove operator routes and a second business are denied.
6. With the primary operator still active, remove the test merchant's access. Confirm its already-open browser and a replayed old cookie cannot perform another protected action. Reassigning access must not revive its revoked old sessions; a fresh login is required.

## Password and session recovery

1. Sign out. On `/login`, choose **Forgot your password?**.
2. Enter the internal account email and choose **Request recovery email**.
3. Observe the email in the actual mailbox. Record request time, receipt time, sender, and canonical host. Exclude the private link from evidence.
4. Open the email in the same browser. Choose **Continue password recovery**.
5. Verify a primary or backup authenticator. Enter and repeat a new password of at least twelve characters. Choose **Save password and sign out**.
6. Confirm a fresh login accepts the new password and requires MFA. Confirm the old password and old browser sessions fail.
7. Retry the same recovery link. It must fail. Repeat with an expired link and with a different browser: both must fail with a clear path to request another link.
8. Use **Sign out all other sessions** and confirm another browser loses access while the current browser remains available.
9. Check logout during a simulated provider outage in an isolated test environment. After provider recovery, replaying the old cookie must still fail. Record provider logout failure separately from the successful application revocation.

## If every authenticator is lost

Use the separately controlled backup authenticator first. If none survives, a second Uptick operator coordinates identity verification with the authorized Supabase project owner. The project owner performs the provider's documented account/factor recovery. Do not disable application MFA enforcement or use a local demo identity on the host. Revoke existing account sessions, record the identity-verification and provider action references, enroll and verify new primary/backup factors, and then rehearse normal login again. This provider-admin recovery remains an external commissioning gate until actually exercised.

## Evidence to record

For each rehearsal record:

- canonical URL, full release SHA, complete applied migration manifest, environment and UTC time;
- account role and a safe internal reference, without passwords or secrets;
- expected result, observed result and a redacted screenshot;
- primary factor and separately controlled backup factor verified (names/status only);
- recovery email observed and one-time completion/replay rejection;
- role and tenant rejection, expired-session rejection, removed-access rejection;
- copied-cookie rejection after current-session and other-session logout;
- provider outage/recovery result and any provider cleanup still required;
- primary and backup accountable owners, plus the next review date.

Do not mark hosted commissioning green from local unit tests alone. No live login, provider email delivery, MFA enrollment or provider recovery has been claimed by this document.

## Local regression evidence

`node --import tsx --test --test-concurrency=1 tests/account-security.test.ts` currently contains four tests covering factor restrictions, provider/session identity checks, expiration, application revocation, and business-access removal. Provider calls in these tests are injected fakes. Browser and hosted rehearsal evidence are separate requirements.

## Primary references

- [Supabase TOTP enrollment and challenge](https://supabase.com/docs/guides/auth/auth-mfa/totp)
- [Supabase password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Supabase sign-out scopes and token limitations](https://supabase.com/docs/reference/javascript/auth-signout)
