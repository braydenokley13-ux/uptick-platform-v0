import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { seed } from "@/lib/seed";
import { localMode } from "@/lib/config";
import { getActor, setSession, clearSession } from "@/lib/auth";
import {
  acceptClaim,
  redeem,
  joinMerchantDrop,
  preferences,
  confirmPassChoices,
  saveDraft,
  approve,
  pauseOffer,
  authorize,
  audit,
  rateLimit,
} from "@/lib/domain";
import { dispatch } from "@/lib/messaging";
import { createPlacementSource, confirmPlacement } from "@/lib/operator";
import { decrypt, id, hash } from "@/lib/security";
import {
  assertSameOrigin,
  readJsonBody,
  requestRatePolicy,
  apiError,
  RequestError,
} from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const data = await readJsonBody(request);
    const action = z.string().min(1).max(40).parse(data.action);
    const db = await getDb();
    if (
      [
        "claim",
        "login",
        "visit",
        "redeem",
        "join-drop",
        "open-pass",
        "preferences",
      ].includes(action)
    ) {
      const policy = requestRatePolicy(request, action);
      await rateLimit(
        db,
        `request:${action}:${hash(policy.identity)}`,
        policy.max,
        3600,
      );
    }
    if (action === "login") {
      if (
        localMode() &&
        typeof data.mode === "string" &&
        ["merchant", "operator", "second"].includes(data.mode)
      ) {
        await seed(db);
        await setSession(`local-${data.mode}`);
        return NextResponse.json({
          redirect: data.mode === "operator" ? "/operator" : "/merchant",
        });
      }
      const email = z.email().parse(data.email);
      const password = z.string().min(1).max(200).parse(data.password);
      await rateLimit(
        db,
        `login-account:${hash(email.toLowerCase())}`,
        10,
        3600,
      );
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)
        throw new RequestError(
          "Account sign-in is temporarily unavailable.",
          503,
        );
      const client = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        { auth: { persistSession: false } },
      );
      const { data: auth, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !auth.session)
        throw Error("Sign-in failed. Check your email and password.");
      const [member] = await db.query<{ role: string }>(
        "select role from memberships where user_id=$1 order by role desc limit 1",
        [auth.user.id],
      );
      if (!member)
        throw Error("Your account has not been assigned business access.");
      await setSession(auth.user.id, auth.session.access_token);
      return NextResponse.json({
        redirect: member.role === "operator" ? "/operator" : "/merchant",
      });
    }
    if (action === "logout") {
      await clearSession();
      return NextResponse.json({ redirect: "/login" });
    }
    if (action === "visit") {
      const sourceToken = z.string().min(1).max(100).parse(data.sourceToken);
      const [s] = await db.query<{ id: string }>(
        "select id from sources where token=$1 and state='active'",
        [sourceToken],
      );
      if (s)
        await db.query(
          "insert into source_visits(id,source_id) values($1,$2)",
          [id(), s.id],
        );
      return NextResponse.json({ ok: true });
    }
    if (action === "claim") {
      const input = z
        .object({
          sourceToken: z.string().min(1).max(100),
          phone: z.string().max(30),
          merchantConsent: z.boolean(),
          networkConsent: z.boolean(),
        })
        .parse(data);
      const claim = await acceptClaim(db, input);
      await dispatch(db, 1);
      return NextResponse.json(
        {
          ok: true,
          development: localMode() && process.env.SMS_TRANSPORT !== "twilio",
          passUrl:
            localMode() && process.env.SMS_TRANSPORT !== "twilio"
              ? `/p/${decrypt(claim.token_encrypted)}`
              : undefined,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (["redeem", "open-pass", "preferences", "join-drop"].includes(action)) {
      const credential = z
        .string()
        .regex(/^[A-Za-z0-9_-]{43}$/)
        .parse(data.token);
      await rateLimit(db, `pass-action:${hash(credential)}`, 60, 3600);
      if (action === "redeem") {
        await redeem(db, credential);
        return NextResponse.json({ ok: true });
      }
      if (action === "join-drop") {
        await joinMerchantDrop(db, credential);
        return NextResponse.json({ ok: true });
      }
      if (action === "open-pass") {
        await confirmPassChoices(
          db,
          credential,
          z.boolean().default(false).parse(data.merchant),
          z.boolean().default(false).parse(data.network),
        );
        return NextResponse.json({ ok: true });
      }
      await preferences(
        db,
        credential,
        z.boolean().parse(data.merchant),
        z.boolean().parse(data.network),
      );
      return NextResponse.json({
        ok: true,
        message: "Your preferences have been saved.",
      });
    }
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Please sign in to continue." },
        { status: 401 },
      );
    await rateLimit(db, `account-action:${actor.id}`, 240, 3600);
    if (action === "save-draft") {
      const input = z
        .object({
          id: z.string().optional(),
          organizationId: z.string(),
          title: z.string().min(1).max(100),
          qualification: z.string().min(1).max(160),
          reward: z.string().min(1).max(160),
          terms: z.string().min(1).max(1000),
          startsAt: z.iso.datetime(),
          expiresAt: z.iso.datetime(),
          limitMode: z.enum(["unlimited", "claim", "redemption"]),
          quantity: z
            .number()
            .int()
            .positive()
            .max(100000)
            .nullable()
            .optional(),
          submit: z.boolean(),
          kind: z.enum(["anchor", "drop"]).optional(),
        })
        .parse(data);
      const offerId = await saveDraft(db, actor, input);
      return NextResponse.json({
        ok: true,
        redirect: `/${actor.role === "operator" ? "operator/review" : "merchant/drops"}?saved=${offerId}`,
      });
    }
    if (actor.role !== "operator")
      return NextResponse.json(
        { error: "This action is available to Uptick operators." },
        { status: 403 },
      );
    if (action === "approve") {
      await approve(
        db,
        actor,
        z.string().parse(data.id),
        z.iso.datetime().parse(data.scheduledAt),
      );
      return NextResponse.json({
        ok: true,
        message: "Approved. The schedule is saved.",
      });
    }
    if (action === "pause") {
      await pauseOffer(db, actor, z.string().parse(data.id));
      return NextResponse.json({
        ok: true,
        message:
          "New claims and pending promotional sends are paused. Existing passes remain valid.",
      });
    }
    if (action === "placement") {
      const input = z
        .object({
          id: z.string().min(1).max(80),
          status: z.enum(["confirmed", "intended", "paused"]),
          note: z.string().trim().min(8).max(600),
          externalReference: z.string().trim().max(120),
        })
        .parse(data);
      await confirmPlacement(db, actor, input);
      return NextResponse.json({ ok: true });
    }
    if (action === "create-business") {
      const input = z
        .object({
          name: z.string().trim().min(2).max(100),
          address: z.string().trim().min(5).max(240),
          capability: z.enum(["merchant", "host"]),
          timezone: z.string().min(1).max(80),
        })
        .parse(data);
      try {
        new Intl.DateTimeFormat("en", { timeZone: input.timezone });
      } catch {
        throw new RequestError("Choose a valid business time zone.");
      }
      const org = id();
      await db.transaction(async (tx) => {
        await tx.query(
          "insert into organizations(id,name,capabilities,timezone) values($1,$2,$3,$4)",
          [org, input.name, [input.capability], input.timezone],
        );
        await tx.query(
          "insert into locations(id,organization_id,name,address) values($1,$2,$3,$4)",
          [id(), org, "Main location", input.address],
        );
        if (input.capability === "merchant")
          await tx.query(
            "insert into senders(id,organization_id) values($1,$2)",
            [id(), org],
          );
        await audit(tx, actor.id, org, "business.created", org);
      });
      return NextResponse.json({
        ok: true,
        message: "Business and location created.",
      });
    }
    if (action === "create-source") {
      const input = z
        .object({
          offerId: z.string().min(1).max(80),
          locationId: z.string().min(1).max(80),
          placement: z.string().trim().min(2).max(100),
          campaign: z.string().trim().min(2).max(120),
          creative: z.string().trim().min(2).max(120),
        })
        .parse(data);
      await createPlacementSource(db, actor, {
        ...input,
        placementType: "wall TV",
        environment: "",
        dwellContext: "",
      });
      return NextResponse.json({
        ok: true,
        message: "Placement and QR source created.",
      });
    }
    if (action === "revoke-source") {
      const sourceId = z.string().min(1).max(80).parse(data.id);
      await db.transaction(async (tx) => {
        const [source] = await tx.query<{ organization_id: string }>(
          "select o.organization_id from sources s join offers o on o.id=s.offer_id where s.id=$1",
          [sourceId],
        );
        if (!source) throw Error("Source not found.");
        authorize(actor, source.organization_id, true);
        await tx.query("update sources set state='revoked' where id=$1", [
          sourceId,
        ]);
        await audit(
          tx,
          actor.id,
          source.organization_id,
          "source.revoked",
          sourceId,
        );
      });
      return NextResponse.json({ ok: true });
    }
    if (action === "sender") {
      const input = z
        .object({
          organizationId: z.string(),
          serviceSid: z.string().regex(/^MG[0-9a-fA-F]{32}$/),
          phone: z.string().regex(/^\+1\d{10}$/),
          approved: z.boolean(),
        })
        .parse(data);
      await db.transaction(async (tx) => {
        const changed = await tx.query(
          "update senders set service_sid=$2,phone=$3,approved=$4 where organization_id=$1 returning id",
          [input.organizationId, input.serviceSid, input.phone, input.approved],
        );
        if (!changed.length)
          throw new RequestError("Choose an existing merchant sender.");
        await audit(
          tx,
          actor.id,
          input.organizationId,
          "sender.configured",
          input.organizationId,
          {
            approved: input.approved,
            configurationFingerprint: hash(
              `${input.serviceSid}:${input.phone}`,
            ),
          },
        );
      });
      return NextResponse.json({
        ok: true,
        message: "Sender configuration saved.",
      });
    }
    if (action === "membership") {
      const input = z
        .object({
          userId: z.string().uuid(),
          organizationId: z.string().min(1).max(80),
          role: z.enum(["merchant", "operator"]),
          canExport: z.boolean(),
        })
        .parse(data);
      await db.transaction(async (tx) => {
        await tx.query(
          "insert into memberships(user_id,organization_id,role,can_export) values($1,$2,$3,$4) on conflict(user_id,organization_id) do update set role=excluded.role,can_export=excluded.can_export",
          [input.userId, input.organizationId, input.role, input.canExport],
        );
        await audit(
          tx,
          actor.id,
          input.organizationId,
          "membership.assigned",
          input.userId,
          { role: input.role, canExport: input.canExport },
        );
      });
      return NextResponse.json({ ok: true, message: "Account access saved." });
    }
    throw Error("Unknown action.");
  } catch (error) {
    return apiError(error);
  }
}
