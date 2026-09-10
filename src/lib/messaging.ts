import twilio from "twilio";
import { simulatedTransport, smsEnvironmentBlock } from "./environment";
import type { DB } from "./db";
import { id, decrypt } from "./security";
import { appUrl, messagingReady } from "./config";
import {
  offerSelect,
  createEntitlement,
  queueMessage,
  isQuietHours,
  weekKey,
  audit,
  type Offer,
  type Claim,
} from "./domain";
import { offerSmsPreview } from "./product";
export type Message = {
  id: string;
  organization_id: string;
  customer_id: string;
  sender_id: string;
  claim_id: string;
  broadcast_id: string | null;
  purpose: string;
  state: string;
  provider_sid: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  suppression_reason: string | null;
};
export async function expandDueBroadcasts(db: DB, now = new Date()) {
  return db.transaction(async (tx) => {
    const broadcasts = await tx.query<{
      id: string;
      offer_id: string;
      organization_id: string;
      week_key: string;
    }>(
      "select * from broadcasts where state='scheduled' and scheduled_at<=$1 order by scheduled_at limit 10",
      [now.toISOString()],
    );
    let expanded = 0;
    for (const candidate of broadcasts) {
      // Match the offer → broadcast lock order used by pause/approval, and skip other workers.
      if (
        !(
          await tx.query(
            "select id from offers where id=$1 for update skip locked",
            [candidate.offer_id],
          )
        ).length
      )
        continue;
      const [b] = await tx.query<typeof candidate>(
        "select * from broadcasts where id=$1 and state='scheduled' for update",
        [candidate.id],
      );
      if (!b) continue;
      const [o] = await tx.query<Offer>(`${offerSelect} where o.id=$1`, [
        b.offer_id,
      ]);
      if (!o || o.state !== "scheduled") continue;
      if (isQuietHours(now, o.timezone)) continue;
      if (
        new Date(o.expires_at) <= now ||
        weekKey(now, o.timezone) !== b.week_key
      ) {
        await tx.query("update broadcasts set state='paused' where id=$1", [
          b.id,
        ]);
        await audit(
          tx,
          "system",
          b.organization_id,
          "broadcast.missed_window",
          b.id,
        );
        continue;
      }
      const customers = await tx.query<{ customer_id: string }>(
        `select s.customer_id from subscriptions s join relationships r on r.customer_id=s.customer_id and r.organization_id=s.organization_id where s.organization_id=$1 and s.state='subscribed' and r.possession_confirmed_at is not null`,
        [b.organization_id],
      );
      let queued = 0;
      for (const c of customers) {
        if (o.limit_mode === "claim") {
          const [n] = await tx.query<{ n: number }>(
            "select count(*)::int n from claims where offer_id=$1",
            [o.id],
          );
          if (n.n >= (o.quantity || 0)) break;
        }
        const claim = await createEntitlement(
          tx,
          o,
          c.customer_id,
          null,
          { broadcast_id: b.id, channel: "weekly_drop" },
          b.id,
        );
        await queueMessage(tx, claim, "merchant", b.id);
        queued++;
      }
      await tx.query("update offers set state='live' where id=$1", [o.id]);
      await tx.query("update broadcasts set state='queued' where id=$1", [
        b.id,
      ]);
      await audit(tx, "system", b.organization_id, "broadcast.queued", b.id, {
        eligibleAudience: customers.length,
        queued,
      });
      expanded++;
    }
    return expanded;
  });
}
export async function eligibility(db: DB, m: Message, now = new Date()) {
  const [c] = await db.query<{ phone: string }>(
    "select phone from customers where id=$1",
    [m.customer_id],
  );
  if (!c) return "Customer not found";
  const [sender] = await db.query<{ organization_id: string }>(
    "select organization_id from senders where id=$1",
    [m.sender_id],
  );
  if (!sender || sender.organization_id !== m.organization_id)
    return "Sender does not match this business";
  const [s] = await db.query<{ suppressed: boolean }>(
    "select suppressed from suppressions where phone=$1 and sender_id=$2",
    [c.phone, m.sender_id],
  );
  if (s?.suppressed) return "Sender opt-out";
  const [claim] = await db.query<Claim>("select * from claims where id=$1", [
    m.claim_id,
  ]);
  if (
    !claim ||
    new Date(claim.snapshot.expires_at) <= now ||
    claim.state !== "active"
  )
    return "Pass no longer active";
  if (
    claim.customer_id !== m.customer_id ||
    claim.organization_id !== m.organization_id
  )
    return "Pass does not match this customer and business";
  if (claim.snapshot.is_demo && process.env.SMS_TRANSPORT === "twilio")
    return "Sample passes cannot be sent through a live provider";
  const environmentBlock = smsEnvironmentBlock(c.phone);
  if (environmentBlock) return environmentBlock;
  if (m.purpose === "fulfillment") {
    const requested = await db.query(
      "select id from consent_events where customer_id=$1 and organization_id=$2 and purpose='fulfillment' and accepted=true limit 1",
      [m.customer_id, m.organization_id],
    );
    if (!requested.length) return "No pass delivery request";
  }
  if (m.purpose === "merchant") {
    const [sub] = await db.query<{ state: string }>(
      "select state from subscriptions where customer_id=$1 and scope=$2",
      [m.customer_id, m.organization_id],
    );
    if (sub?.state !== "subscribed") return "No current merchant consent";
    const [rel] = await db.query<{ possession_confirmed_at: string }>(
      "select possession_confirmed_at from relationships where customer_id=$1 and organization_id=$2",
      [m.customer_id, m.organization_id],
    );
    if (!rel?.possession_confirmed_at) return "Phone possession not confirmed";
    const [b] = await db.query<{
      state: string;
      week_key: string;
      organization_id: string;
      offer_id: string;
    }>(
      "select state,week_key,organization_id,offer_id from broadcasts where id=$1",
      [m.broadcast_id],
    );
    if (
      !b ||
      !["queued", "complete"].includes(b.state) ||
      b.organization_id !== m.organization_id ||
      b.offer_id !== claim.offer_id ||
      claim.broadcast_id !== m.broadcast_id
    )
      return "Drop is not active";
    const [o] = await db.query<Offer>(`${offerSelect} where o.id=$1`, [
      claim.offer_id,
    ]);
    if (!o || o.state !== "live") return "Offer paused";
    if (weekKey(now, o.timezone) !== b.week_key)
      return "Scheduled week has passed";
    if (new Date(claim.snapshot.starts_at) > now) return "not_started";
    if (isQuietHours(now, o.timezone)) return "quiet_hours";
    const sent = await db.query<{ week_key: string }>(
      `select b.week_key from messages m join broadcasts b on b.id=m.broadcast_id where m.customer_id=$1 and m.organization_id=$2 and m.id<>$3 and m.purpose='merchant' and m.state in ('submitting','provider_accepted','sent','delivered','undelivered','unknown','development')`,
      [m.customer_id, m.organization_id, m.id],
    );
    if (sent.some((x) => x.week_key === b.week_key))
      return "Weekly frequency limit";
  }
  return null;
}
export async function dispatch(db: DB, limit = 20) {
  // Provider submissions with an uncertain result are never blindly retried.
  await db.query(
    "update messages set state='unknown',error_code='worker_interrupted',updated_at=now() where state='submitting' and updated_at<now()-interval '5 minutes'",
  );
  let processed = 0;
  const deferred: string[] = [];
  for (let i = 0; i < limit; i++) {
    const job = await db.transaction(async (tx) => {
      const [m] = await tx.query<Message>(
        "select * from messages where state='queued' and not(id=any($1::text[])) order by created_at,id limit 1 for update skip locked",
        [deferred],
      );
      if (!m) return null;
      // Serialize frequency checks for this customer across independent workers.
      await tx.query("select id from customers where id=$1 for update", [
        m.customer_id,
      ]);
      const reason = await eligibility(tx, m);
      if (reason === "quiet_hours" || reason === "not_started")
        return { deferred: true, m };
      if (reason) {
        await tx.query(
          "update messages set state='suppressed',suppression_reason=$2,updated_at=now() where id=$1",
          [m.id, reason],
        );
        return { skip: true, m };
      }
      const [sender] = await tx.query<{
        service_sid: string;
        approved: boolean;
      }>("select * from senders where id=$1", [m.sender_id]);
      if (
        !simulatedTransport() &&
        (!messagingReady() || !sender?.approved || !sender.service_sid)
      )
        return { deferred: true, m };
      await tx.query(
        "update messages set state='submitting',updated_at=now() where id=$1",
        [m.id],
      );
      const [c] = await tx.query<{ phone: string }>(
        "select phone from customers where id=$1",
        [m.customer_id],
      );
      const [claim] = await tx.query<Claim>(
        "select * from claims where id=$1",
        [m.claim_id],
      );
      return { skip: false, m, c, claim, sender };
    });
    if (!job) break;
    if ("deferred" in job) {
      deferred.push(job.m.id);
      continue;
    }
    if (job.skip) {
      processed++;
      continue;
    }
    const { m, c, claim, sender } = job;
    if (simulatedTransport()) {
      await db.query(
        "update messages set state='development',updated_at=now() where id=$1",
        [m.id],
      );
      processed++;
      continue;
    }
    if (!messagingReady() || !sender?.approved) {
      await db.query(
        "update messages set state='queued',updated_at=now() where id=$1",
        [m.id],
      );
      break;
    }
    // Recheck after taking work, immediately before invoking the provider.
    const reason = await eligibility(db, m);
    if (reason) {
      await db.query(
        "update messages set state=$2,suppression_reason=$3,updated_at=now() where id=$1",
        [
          m.id,
          ["quiet_hours", "not_started"].includes(reason)
            ? "queued"
            : "suppressed",
          ["quiet_hours", "not_started"].includes(reason) ? null : reason,
        ],
      );
      processed++;
      continue;
    }
    const passUrl = `${appUrl()}/p/${decrypt(claim!.token_encrypted)}`;
    const body = offerSmsPreview(
      claim!.snapshot.merchant,
      claim!.snapshot.qualification,
      claim!.snapshot.reward,
      m.purpose === "merchant" ? "drop" : "anchor",
      passUrl,
    );
    try {
      const provider = await twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
        { autoRetry: false, timeout: 15000 },
      ).messages.create({
        to: c!.phone,
        messagingServiceSid: sender!.service_sid,
        body,
        statusCallback: `${appUrl()}/api/twilio/status?message=${m.id}`,
      });
      await db.query(
        "update messages set provider_sid=$2,state=case when state='submitting' then 'provider_accepted' else state end,updated_at=now() where id=$1",
        [m.id, provider.sid],
      );
    } catch (error) {
      const e = error as { status?: number; code?: number };
      const definitive = e.status && e.status >= 400 && e.status < 500;
      await db.query(
        "update messages set state=$2,error_code=$3,updated_at=now() where id=$1 and state='submitting'",
        [
          m.id,
          definitive ? "failed" : "unknown",
          String(e.code || "provider_response_uncertain"),
        ],
      );
    }
    processed++;
  }
  await db.query(
    "update broadcasts b set state='complete' where state='queued' and not exists(select 1 from messages m where m.broadcast_id=b.id and m.state in ('queued','submitting'))",
  );
  return processed;
}
const rank: Record<string, number> = {
  queued: 0,
  submitting: 1,
  provider_accepted: 2,
  sent: 3,
  failed: 4,
  undelivered: 4,
  delivered: 5,
  unknown: 1,
};
export async function statusCallback(
  db: DB,
  messageId: string,
  sid: string,
  status: string,
  errorCode?: string,
) {
  if (!/^[SM]M[0-9a-fA-F]{32}$/.test(sid))
    throw Error("Invalid provider message.");
  if (
    ![
      "accepted",
      "queued",
      "sending",
      "sent",
      "failed",
      "undelivered",
      "delivered",
    ].includes(status)
  )
    return;
  const mapped =
    status === "accepted" || status === "queued" || status === "sending"
      ? "provider_accepted"
      : status;
  await db.transaction(async (tx) => {
    const [m] = await tx.query<Message>(
      "select * from messages where id=$1 for update",
      [messageId],
    );
    if (!m || (m.provider_sid && m.provider_sid !== sid))
      throw Error("Unknown provider message.");
    if (
      ![
        "submitting",
        "unknown",
        "provider_accepted",
        "sent",
        "failed",
        "undelivered",
        "delivered",
      ].includes(m.state)
    )
      throw Error("Message was not submitted.");
    const added = await tx.query(
      "insert into message_events(id,message_id,provider_sid,state,error_code) values($1,$2,$3,$4,$5) on conflict(provider_sid,state) do nothing returning id",
      [id(), m.id, sid, mapped, errorCode || null],
    );
    if (!added.length) return;
    if ((rank[mapped] || 0) > (rank[m.state] || 0))
      await tx.query(
        "update messages set state=$2,provider_sid=$3,error_code=$4,updated_at=now() where id=$1",
        [m.id, mapped, sid, errorCode || null],
      );
    else if (!m.provider_sid)
      await tx.query("update messages set provider_sid=$2 where id=$1", [
        m.id,
        sid,
      ]);
  });
}
export async function inbound(db: DB, params: Record<string, string>) {
  if (
    !/^[SM]M[0-9a-fA-F]{32}$/.test(params.MessageSid || "") ||
    !/^\+[1-9]\d{7,14}$/.test(params.From || "")
  )
    throw Error("Invalid inbound message.");
  const action = (params.OptOutType || params.Body || "").trim().toUpperCase();
  const normalized = [
    "STOP",
    "STOPALL",
    "UNSUBSCRIBE",
    "CANCEL",
    "END",
    "QUIT",
    "REVOKE",
    "OPTOUT",
  ].includes(action)
    ? "STOP"
    : ["START", "UNSTOP", "YES"].includes(action)
      ? "START"
      : action === "HELP"
        ? "HELP"
        : "OTHER";
  await db.transaction(async (tx) => {
    const [sender] = params.MessagingServiceSid
      ? await tx.query<{ id: string }>(
          "select id from senders where service_sid=$1",
          [params.MessagingServiceSid],
        )
      : await tx.query<{ id: string }>(
          "select id from senders where phone=$1",
          [params.To || ""],
        );
    if (!sender) throw Error("Unknown sender.");
    const inserted = await tx.query(
      "insert into inbound_events(provider_sid,sender_id,action) values($1,$2,$3) on conflict do nothing returning provider_sid",
      [params.MessageSid, sender.id, normalized],
    );
    if (!inserted.length) return;
    if (normalized === "STOP" || normalized === "START") {
      await tx.query(
        "insert into suppressions(phone,sender_id,suppressed) values($1,$2,$3) on conflict(phone,sender_id) do update set suppressed=excluded.suppressed,updated_at=now()",
        [params.From, sender.id, normalized === "STOP"],
      );
      if (normalized === "STOP") {
        const [c] = await tx.query<{ id: string }>(
          "select id from customers where phone=$1",
          [params.From],
        );
        if (c) {
          const subs = await tx.query<{
            scope: string;
            organization_id: string | null;
          }>(
            "select * from subscriptions where customer_id=$1 and (scope='network' or organization_id in(select organization_id from senders where id=$2))",
            [c.id, sender.id],
          );
          for (const sub of subs) {
            await tx.query(
              "update subscriptions set state='unsubscribed',updated_at=now() where customer_id=$1 and scope=$2",
              [c.id, sub.scope],
            );
            await tx.query(
              "insert into consent_events(id,customer_id,organization_id,purpose,accepted,disclosure_version,disclosure,source_ui,phone) values($1,$2,$3,$4,false,$5,$6,$7,$8)",
              [
                id(),
                c.id,
                sub.organization_id,
                sub.scope === "network" ? "network" : "merchant",
                "2026-09-v1",
                "STOP received for this sender.",
                "twilio-inbound",
                params.From,
              ],
            );
          }
          await tx.query(
            "update messages set state='suppressed',suppression_reason='Sender opt-out',updated_at=now() where customer_id=$1 and sender_id=$2 and state='queued'",
            [c.id, sender.id],
          );
        }
      }
      // START removes sender suppression only. It never resurrects a merchant marketing subscription.
    }
  });
  return normalized;
}
