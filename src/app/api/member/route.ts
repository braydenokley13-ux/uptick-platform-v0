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
  confirmMemberAccess,
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
import { shareUptick, acceptPendingReferral } from "@/lib/member-experience";
export const runtime = "nodejs";
const credentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
async function setPrivateCookie(name: string, value: string) {
  (await cookies()).set(name, encrypt(value), {
    httpOnly: true,
    secure: !localMode(),
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
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
          consentRequested: z.literal(true),
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
      const environmentBlock = smsEnvironmentBlock(normalizePhone(input.phone));
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
    const credential = credentialSchema.parse(data.token);
    await rateLimit(db, `member-private:${hash(credential)}`, 120, 3600);
    if (action === "confirm") {
      await confirmMemberAccess(
        db,
        credential,
        z.boolean().parse(data.acceptMembership),
      );
      await acceptPendingReferral(db, credential);
      await setPrivateCookie("uptick-member-access", credential);
      return reply({ ok: true, redirect: `/u/${credential}` });
    }
    if (action === "pair") {
      const pass = await networkPass(db, credential);
      if (!pass) throw new RequestError("Open your current Uptick pass.");
      await setPrivateCookie("uptick-active-pass", credential);
      return reply({
        ok: true,
        message:
          "Your pass is ready. Tap the Uptick sign or scan its QR at the store.",
      });
    }
    if (action === "pass-directions") {
      const pass = await networkPass(db, credential);
      if (!pass) throw new RequestError("Open your Uptick pass.", 403);
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
    const { member } = await memberAccess(db, credential, true);
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
      await setPrivateCookie("uptick-active-pass", pass);
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
