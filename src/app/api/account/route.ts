import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { appUrl, localMode } from "@/lib/config";
import {
  assertSameOrigin,
  apiError,
  readJsonBody,
  RequestError,
  requestIdentity,
} from "@/lib/http";
import {
  accountSession,
  connectedAccountSession,
  setSession,
  clearSession,
  getActor,
} from "@/lib/auth";
import {
  accountFactors,
  assertFactorAction,
  assignBusinessAccess,
  businessMembership,
  revokeAccountSession,
  revokeBusinessAccess,
  verifyAccountIdentity,
} from "@/lib/account-security";
import { recoveryAuthClient } from "@/lib/account-recovery";
import { audit, rateLimit } from "@/lib/domain";
import { hash } from "@/lib/security";

export const runtime = "nodejs";
const reply = (value: object) =>
  NextResponse.json(value, {
    headers: { "Cache-Control": "private, no-store" },
  });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const data = await readJsonBody(request);
    const action = z
      .enum([
        "request_recovery",
        "exchange_recovery",
        "enroll",
        "verify",
        "remove",
        "password",
        "revoke_others",
        "remove_access",
        "assign_access",
      ])
      .parse(data.action);
    if (localMode())
      throw new RequestError(
        "Hosted account changes are unavailable in the local demo.",
        403,
      );
    const db = await getDb();
    await rateLimit(
      db,
      `account-security:${hash(requestIdentity(request))}`,
      120,
      3600,
    );
    if (action === "request_recovery") {
      const email = z.email().parse(data.email).toLowerCase();
      await rateLimit(db, `account-recovery:${hash(email)}`, 4, 3600);
      const client = await recoveryAuthClient();
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl()}/account/recovery`,
      });
      // Never reveal whether an email belongs to an account. Provider errors are
      // recorded without the submitted email or private recovery credentials.
      await audit(
        db,
        "public",
        null,
        "account.recovery_requested",
        "password-recovery",
        { providerAccepted: !error, errorCode: error?.code || null },
      );
      return reply({
        message:
          "If this email can receive a recovery link, it will arrive shortly. Open it in this same browser within fifteen minutes. If it does not arrive, contact your Uptick operator.",
      });
    }
    if (action === "exchange_recovery") {
      const code = z.string().min(16).max(500).parse(data.code);
      const flowId = z
        .string()
        .regex(/^[a-zA-Z0-9_-]{8,64}$/)
        .optional()
        .parse(data.flowId);
      // This dedicated PKCE store is populated only by resetPasswordForEmail.
      // A code from another flow cannot match its private verifier.
      const client = await recoveryAuthClient();
      const { data: result, error } = await client.auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined,
      );
      if (error || !result.session)
        throw new RequestError(
          "This recovery link expired or was opened in a different browser. Request a new link.",
          401,
        );
      try {
        await businessMembership(db, result.user.id);
      } catch (error) {
        await client.auth.signOut({ scope: "local" });
        throw error;
      }
      await setSession(
        result.user.id,
        result.session.access_token,
        result.session.refresh_token,
        true,
      );
      await audit(
        db,
        result.user.id,
        null,
        "account.recovery_verified",
        result.user.id,
      );
      return reply({ redirect: "/account/security" });
    }
    if (action === "remove_access" || action === "assign_access") {
      const actor = await getActor();
      if (!actor)
        throw new RequestError("Sign in with full operator access first.", 401);
      if (action === "assign_access")
        await assignBusinessAccess(db, actor, {
          ...data,
          canExport: data.canExport === true || data.canExport === "on",
        });
      else await revokeBusinessAccess(db, actor, data);
      return reply({
        message:
          action === "assign_access"
            ? "Verified account access saved."
            : "Business access and all existing Uptick sessions for this account are revoked.",
      });
    }
    const { session, client } = await connectedAccountSession();
    const identity = await verifyAccountIdentity(
      db,
      session.accessToken,
      client,
    );
    await businessMembership(db, identity.userId);
    await rateLimit(db, `account-security-user:${identity.userId}`, 30, 3600);
    const factors = await accountFactors(client);
    if (["enroll", "verify", "remove"].includes(action)) {
      const factorId =
        action === "enroll" ? undefined : z.uuid().parse(data.factorId);
      assertFactorAction(
        action as "enroll" | "verify" | "remove",
        identity.claims.aal,
        factors,
        factorId,
      );
      if (session.recoveryOnly && action !== "verify")
        throw new RequestError(
          "Complete password recovery before changing authenticators.",
          403,
        );
      if (action === "enroll") {
        const name = z.string().trim().min(3).max(50).parse(data.name);
        const { data: factor, error } = await client.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: name,
          issuer: "Uptick",
        });
        if (error || !factor)
          throw new RequestError(
            "Authenticator setup could not start. Choose a unique name or remove an unfinished setup.",
          );
        await audit(
          db,
          identity.userId,
          null,
          "account.factor_enrollment_started",
          factor.id,
        );
        return reply({
          enrollment: {
            id: factor.id,
            secret: factor.totp.secret,
            qr: factor.totp.qr_code,
          },
        });
      }
      if (action === "verify") {
        const code = z
          .string()
          .regex(/^\d{6}$/)
          .parse(data.code);
        const { data: verified, error } =
          await client.auth.mfa.challengeAndVerify({
            factorId: factorId!,
            code,
          });
        if (error || !verified)
          throw new RequestError(
            "That authenticator code did not work. Enter the current six-digit code.",
            401,
          );
        await setSession(
          identity.userId,
          verified.access_token,
          verified.refresh_token,
          session.recoveryOnly,
        );
        await audit(
          db,
          identity.userId,
          null,
          "account.factor_verified",
          factorId!,
        );
        return reply({
          message:
            "Authenticator verified. Your session now has two-factor protection.",
        });
      }
      const { error } = await client.auth.mfa.unenroll({ factorId: factorId! });
      if (error)
        throw new RequestError(
          "This authenticator could not be removed. Verify another factor and try again.",
        );
      await audit(
        db,
        identity.userId,
        null,
        "account.factor_removed",
        factorId!,
      );
      return reply({
        message:
          "Authenticator removed. Keep your remaining authenticator available.",
      });
    }
    if (
      factors.some((f) => f.status === "verified") &&
      identity.claims.aal !== "aal2"
    )
      throw new RequestError(
        "Verify your authenticator before changing security settings.",
        403,
      );
    if (action === "password") {
      const password = z
        .string()
        .min(12, "Use at least twelve characters.")
        .max(200)
        .parse(data.password);
      if (!session.recoveryOnly)
        throw new RequestError(
          "Request a password recovery link to change your password.",
          403,
        );
      const { error } = await client.auth.updateUser({ password });
      if (error)
        throw new RequestError(
          "The new password was not accepted. Use a different strong password and try again.",
        );
      // Revoke all application sessions before provider logout, including if the
      // provider's logout call subsequently fails.
      await db.query(
        `insert into account_session_revocations(session_id,user_id,reason) select id::text,user_id::text,'Password recovery completed' from auth.sessions where user_id=$1::uuid on conflict do nothing`,
        [identity.userId],
      );
      await audit(
        db,
        identity.userId,
        null,
        "account.password_recovered",
        identity.userId,
      );
      const { error: logoutError } = await client.auth.signOut({
        scope: "global",
      });
      await clearSession();
      return reply({
        redirect: `/login?recovered=${logoutError ? "application-sessions-revoked" : "true"}`,
      });
    }
    if (session.recoveryOnly)
      throw new RequestError("Complete password recovery first.", 403);
    const others = await db.query<{ id: string }>(
      "select id::text from auth.sessions where user_id=$1::uuid and id<>$2::uuid",
      [identity.userId, identity.claims.session_id],
    );
    for (const other of others)
      await revokeAccountSession(
        db,
        { ...identity, claims: { ...identity.claims, session_id: other.id } },
        "Account owner revoked other sessions",
      );
    const { error } = await client.auth.signOut({ scope: "others" });
    return reply({
      message: error
        ? "Other Uptick sessions are revoked. Provider logout could not be confirmed; retry to finish provider logout."
        : "All other account sessions are signed out.",
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET() {
  try {
    const session = await accountSession();
    const db = await getDb();
    const { client } = await connectedAccountSession();
    const identity = await verifyAccountIdentity(
      db,
      session.accessToken,
      client,
    );
    const membership = await businessMembership(db, session.userId);
    const factors = await accountFactors(client);
    const mustVerify =
      identity.claims.aal !== "aal2" &&
      (factors.some((f) => f.status === "verified") ||
        (membership.role === "operator" &&
          process.env.OPERATOR_MFA_REQUIRED === "true"));
    return reply({
      email: identity.email,
      role: membership.role,
      aal: identity.claims.aal,
      factors,
      recoveryOnly: session.recoveryOnly,
      mustVerify,
      destination:
        membership.role === "operator" ? "/operator/pilot" : "/merchant",
    });
  } catch (error) {
    return apiError(error);
  }
}
