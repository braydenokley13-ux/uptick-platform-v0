import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { localMode } from "@/lib/config";
import {
  assertSameOrigin,
  readJsonBody,
  requestRatePolicy,
  apiError,
  RequestError,
} from "@/lib/http";
import { rateLimit } from "@/lib/domain";
import { hash, decrypt, encrypt } from "@/lib/security";
import {
  requestMemberAccess,
  exchangeMemberAccess,
  memberAccess,
  memberPreferences,
  claimMemberDrop,
  networkPass,
  demandEvent,
} from "@/lib/network";
import {
  queueMemberAccess,
  dispatchRequestedMemberAccess,
  memberMessagingReadiness,
} from "@/lib/member-messaging";
import { smsEnvironmentBlock } from "@/lib/environment";
import { normalizePhone } from "@/lib/security";
import {
  shareUptick,
  acceptPendingReferral,
  createMemberSupportRequest,
  memberIncidentGrant,
  memberSupportQueue,
  resolveMemberSupportRequest,
} from "@/lib/member-experience";
import { getActor } from "@/lib/auth";
import {
  MEMBER_SESSION_COOKIE,
  memberSessionCookie,
  recoverMemberSession,
  replaceMemberRecoveryCodes,
  revokeMemberSession,
} from "@/lib/member-session";
import { reportMemberFulfillmentIncident } from "@/lib/pilot-promise";
import { recordMemberServiceEvent } from "@/lib/member-service";
import { assertLocationAvailable } from "@/lib/location-outages";
import { createPrivacyRequest } from "@/lib/privacy-admin";
export const runtime = "nodejs";
const credentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
async function setMemberSessionCookie(value: string) {
  const cookie = memberSessionCookie(value);
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
}
async function accountCredential() {
  const credential = (await cookies()).get(MEMBER_SESSION_COOKIE)?.value;
  if (!credential) throw new RequestError("Open Your Uptick to continue.", 401);
  return credentialSchema.parse(credential);
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const data = await readJsonBody(request),
      action = z
        .enum([
          "join",
          "confirm",
          "preferences",
          "claim",
          "pair",
          "view",
          "directions",
          "pass-directions",
          "share",
          "help",
          "incident",
          "recovery-codes",
          "recover",
          "signout",
          "withdraw",
          "privacy-request",
          "support-queue",
          "resolve-support",
        ])
        .parse(data.action),
      db = await getDb();
    const rate = requestRatePolicy(
      request,
      action === "join" ? "claim" : action,
    );
    await rateLimit(
      db,
      `member-http:${action}:${hash(rate.identity)}`,
      rate.max,
      3600,
    );
    const reply = (value: object) =>
      Response.json(value, {
        headers: { "Cache-Control": "private, no-store" },
      });
    if (action === "join") {
      const input = z
        .object({
          phone: z.string().max(30),
          homeZip: z.string().regex(/^\d{5}$/),
          workZip: z
            .string()
            .regex(/^(\d{5})?$/)
            .optional(),
          sourceToken: z.string().max(100).optional(),
          referralToken: credentialSchema.optional(),
          consentRequested: z.boolean().optional().default(false),
          ageAttested: z.literal(true),
        })
        .parse(data);
      const readiness = await memberMessagingReadiness(db);
      const development =
        localMode() && process.env.SMS_TRANSPORT === "development";
      if (!development && (!readiness.ready || readiness.simulated))
        throw new RequestError(
          "Membership text requests are not available in this environment yet.",
          503,
        );
      const environmentBlock = smsEnvironmentBlock(
        normalizePhone(input.phone),
        "access",
      );
      if (environmentBlock)
        throw new RequestError(
          "This number is not enabled for membership text requests in this environment.",
          403,
        );
      const result = await requestMemberAccess(db, input);
      const message = await queueMemberAccess(db, result.access.id);
      const outcome = await dispatchRequestedMemberAccess(db, message.id);
      if (
        !development &&
        !["provider_accepted", "sent", "delivered"].includes(outcome.state)
      )
        throw new RequestError(
          "We could not confirm your access text. Please wait before trying again, and contact Uptick if it does not arrive.",
          503,
        );
      return reply({
        ok: true,
        development,
        deliveryState: outcome.state,
        privateUrl: development ? `/u/${result.credential}` : undefined,
      });
    }
    if (action === "confirm") {
      const accessCredential = credentialSchema.parse(data.token);
      await rateLimit(
        db,
        `member-private:${hash(accessCredential)}`,
        120,
        3600,
      );
      const exchanged = await exchangeMemberAccess(
        db,
        accessCredential,
        z.boolean().parse(data.acceptMarketing),
      );
      await acceptPendingReferral(db, exchanged.credential);
      await setMemberSessionCookie(exchanged.credential);
      return reply({ ok: true, redirect: "/your-uptick" });
    }
    if (action === "recover") {
      const input = z
        .object({ phone: z.string().max(30), code: z.string().max(40) })
        .parse(data);
      await rateLimit(
        db,
        `member-recovery:${hash(`${input.phone}:${input.code}`)}`,
        10,
        3600,
      );
      const recovered = await recoverMemberSession(db, input);
      await setMemberSessionCookie(recovered.credential);
      return reply({ ok: true, redirect: "/your-uptick" });
    }
    if (action === "pair") {
      const passCredential = credentialSchema.parse(data.token);
      const pass = await networkPass(db, passCredential);
      if (!pass) throw new RequestError("Open your current Uptick pass.");
      (await cookies()).set("uptick-active-pass", encrypt(passCredential), {
        httpOnly: true,
        secure: !localMode(),
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 86400,
      });
      return reply({
        ok: true,
        message:
          "Your pass is ready. Tap the Uptick sign or scan its QR at the store.",
      });
    }
    if (action === "pass-directions") {
      const passCredential = credentialSchema.parse(data.token);
      const pass = await networkPass(db, passCredential);
      if (!pass) throw new RequestError("Open your Uptick pass.", 403);
      await assertLocationAvailable(
        db,
        pass.recovery?.target_location_id || pass.supply.location_id,
      );
      const provider = z.enum(["apple", "google", "waze"]).parse(data.provider);
      await demandEvent(db, {
        kind: "directions_requested",
        memberId: pass.mapping.member_id,
        marketId: pass.supply.market_id,
        organizationId: pass.supply.organization_id,
        locationId: pass.supply.location_id,
        supplyId: pass.supply.id,
        claimId: pass.claim.id,
        detail: { provider, surface: "saved_pass" },
      });
      return reply({ ok: true });
    }
    if (action === "support-queue" || action === "resolve-support") {
      const actor = await getActor();
      if (!actor || actor.role !== "operator")
        throw new RequestError("Operator access is required.", 403);
      if (action === "resolve-support")
        await resolveMemberSupportRequest(
          db,
          actor,
          z.string().min(1).max(80).parse(data.requestId),
          z.string().trim().min(3).max(1000).parse(data.resolution),
        );
      return reply({ ok: true, requests: await memberSupportQueue(db, actor) });
    }
    const credential = await accountCredential();
    await rateLimit(db, `member-session:${hash(credential)}`, 120, 3600);
    const { member } = await memberAccess(db, credential, true);
    if (action === "privacy-request") {
      await createPrivacyRequest(
        db,
        { memberId: member.id },
        { ...data, memberId: member.id },
      );
      return reply({
        ok: true,
        message:
          "Your privacy request is recorded. Uptick support will verify the request before taking action.",
      });
    }
    if (action === "withdraw") {
      await recordMemberServiceEvent(
        db,
        { memberId: member.id },
        {
          memberId: member.id,
          kind: "withdrawn",
          reason: data.reason,
          requestKey: data.requestKey,
        },
      );
      return reply({
        ok: true,
        message:
          "You have withdrawn from future weekly releases. Already-issued benefits and support remain available. Contact Uptick support if you wish to return.",
      });
    }
    if (action === "signout") {
      await revokeMemberSession(db, credential);
      (await cookies()).delete(MEMBER_SESSION_COOKIE);
      return reply({ ok: true, redirect: "/join" });
    }
    if (action === "recovery-codes") {
      const codes = await replaceMemberRecoveryCodes(db, member.id);
      return reply({ ok: true, codes });
    }
    if (action === "help") {
      await createMemberSupportRequest(
        db,
        credential,
        z.string().trim().max(2000).optional().parse(data.message),
      );
      return reply({
        ok: true,
        message: "Your help request is in the Uptick support queue.",
      });
    }
    if (action === "incident") {
      const grantId = await memberIncidentGrant(
        db,
        member.id,
        z.string().min(1).max(80).parse(data.grantId),
      );
      const incidentType = z
        .enum([
          "out_of_stock",
          "staff_refusal",
          "unexpected_closure",
          "incorrect_terms",
          "qr_failure",
          "redemption_failure",
          "messaging_issue",
          "member_complaint",
          "inventory_mismatch",
          "other",
        ])
        .parse(data.incidentType);
      const incidentId = await reportMemberFulfillmentIncident(db, member.id, {
        grantId,
        incidentType,
        severity: [
          "out_of_stock",
          "staff_refusal",
          "unexpected_closure",
          "redemption_failure",
        ].includes(incidentType)
          ? "high"
          : "medium",
        occurredAt: new Date().toISOString(),
        owner: "Uptick member support",
        note: z.string().trim().max(2000).default("").parse(data.message),
        idempotencyKey: z.string().min(8).max(200).parse(data.idempotencyKey),
      });
      return reply({
        ok: true,
        incidentId,
        message:
          "Your fulfillment incident is recorded. Uptick support can attach a backed recovery to this same pass.",
      });
    }
    if (action === "preferences") {
      await memberPreferences(
        db,
        credential,
        z
          .object({
            homeZip: z.string(),
            workZip: z.string(),
            subscribed: z.boolean(),
          })
          .parse(data),
      );
      return reply({ ok: true, message: "Your Uptick preferences are saved." });
    }
    if (action === "claim") {
      const claim = await claimMemberDrop(
        db,
        credential,
        z.string().min(1).max(80).parse(data.supplyId),
      );
      const pass = decrypt(claim.token_encrypted);
      (await cookies()).set("uptick-active-pass", encrypt(pass), {
        httpOnly: true,
        secure: !localMode(),
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 86400,
      });
      return reply({ ok: true, redirect: `/p/${pass}` });
    }
    if (action === "share") {
      const publicToken = await shareUptick(
        db,
        credential,
        z.string().max(80).optional().parse(data.supplyId),
      );
      return reply({ ok: true, url: `/r/${publicToken}` });
    }
    const supplyId = z.string().min(1).max(80).parse(data.supplyId);
    const [context] = await db.query<{
      allocation_id: string;
      market_id: string;
      organization_id: string;
      location_id: string;
      rank: number;
    }>(
      `select a.id allocation_id,a.market_id,s.organization_id,s.location_id,o.rank from member_allocations a join allocation_options o on o.allocation_id=a.id join network_drop_supplies s on s.id=o.supply_id where a.member_id=$1 and s.id=$2 order by a.created_at desc limit 1`,
      [member.id, supplyId],
    );
    if (!context)
      throw new RequestError("This Drop is not in your Uptick choices.", 403);
    if (action === "directions")
      await assertLocationAvailable(db, context.location_id);
    const provider =
      action === "directions"
        ? z.enum(["apple", "google", "waze"]).parse(data.provider)
        : undefined;
    await demandEvent(db, {
      kind:
        action === "view"
          ? context.rank === 1
            ? "featured_drop_viewed"
            : "alternative_viewed"
          : "directions_requested",
      memberId: member.id,
      marketId: context.market_id,
      organizationId: context.organization_id,
      locationId: context.location_id,
      supplyId,
      allocationId: context.allocation_id,
      sourceId: member.source_id,
      detail: provider ? { provider } : { rank: context.rank },
      dedupKey:
        action === "view"
          ? `view:${context.allocation_id}:${supplyId}`
          : undefined,
    });
    return reply({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
