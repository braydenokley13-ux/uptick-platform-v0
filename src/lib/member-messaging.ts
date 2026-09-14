import twilio from "twilio";
import type { DB } from "./db";
import { audit, authorize, isQuietHours, weekKey, type Actor } from "./domain";
import { appUrl, messagingReady } from "./config";
import {
  simulatedTransport,
  smsEnvironmentBlock,
  uptickEnvironment,
} from "./environment";
import { platformReadiness } from "./launch";
import { id, decrypt, encrypt } from "./security";
import { RequestError, readBody } from "./http";
import { recordMemberConsent } from "./membership-identity";

export type MemberMessage = {
  id: string;
  member_id: string;
  access_id: string;
  sender_id: string | null;
  purpose: "access" | "drop";
  allocation_id: string | null;
  week_key: string | null;
  timezone: string;
  scheduled_at: string;
  expires_at: string;
  environment: string;
  state: string;
  provider_sid: string | null;
  error_code: string | null;
  suppression_reason: string | null;
  created_at: string;
};
type Access = {
  id: string;
  member_id: string;
  purpose: string;
  expires_at: string;
  token_encrypted: string;
  confirmed_at: string | null;
};
type Member = {
  id: string;
  state: string;
  verified_at: string | null;
  phone: string;
};
type Sender = {
  id: string;
  service_sid: string;
  phone: string;
  approved: boolean;
  active: boolean;
};
export type MemberSmsProvider = (input: {
  to: string;
  messagingServiceSid: string;
  body: string;
  statusCallback: string;
}) => Promise<{ sid: string }>;
const provider: MemberSmsProvider = (input) =>
  twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, {
    autoRetry: false,
    timeout: 15000,
  }).messages.create(input);

export async function configureMemberSender(
  db: DB,
  actor: Actor,
  input: { serviceSid: string; phone: string; approved: boolean },
) {
  authorize(actor, actor.organizationId, true);
  if (
    !/^MG[0-9a-fA-F]{32}$/.test(input.serviceSid) ||
    !/^\+1\d{10}$/.test(input.phone) ||
    typeof input.approved !== "boolean"
  )
    throw new RequestError(
      "Enter the Uptick membership Messaging Service and its US sender number.",
    );
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(73418,1)");
    // A single operator organization lock serializes service replacements.
    await tx.query("select id from organizations where id=$1 for update", [
      actor.organizationId,
    ]);
    if (
      (
        await tx.query(
          "select id from senders where service_sid=$1 or phone=$2",
          [input.serviceSid, input.phone],
        )
      ).length
    )
      throw new RequestError(
        "Use a dedicated Uptick membership sender, separate from merchant programs.",
      );
    await tx.query("update member_senders set active=false where active");
    const [sender] = await tx.query<Sender>(
      `insert into member_senders(id,service_sid,phone,approved) values($1,$2,$3,$4) on conflict(service_sid) do update set phone=excluded.phone,approved=excluded.approved,active=true returning *`,
      [id(), input.serviceSid, input.phone, input.approved],
    );
    await audit(tx, actor.id, null, "membership.sender_configured", sender.id, {
      serviceSid: input.serviceSid,
      approved: input.approved,
    });
    return sender;
  });
}
export async function memberMessagingReadiness(db: DB) {
  const [sender] = await db.query<Sender>(
    "select * from member_senders where active",
  );
  const environment = uptickEnvironment();
  return {
    environment,
    simulated: simulatedTransport(),
    ready:
      simulatedTransport() || (platformReadiness().ready && !!sender?.approved),
    sender: sender
      ? {
          serviceSid: sender.service_sid,
          phone: sender.phone,
          approved: sender.approved,
        }
      : null,
    checks: platformReadiness().checks,
  };
}
async function member(db: DB, memberId: string) {
  const [found] = await db.query<Member>(
    "select m.id,m.state,m.verified_at,c.phone from uptick_members m join customers c on c.id=m.customer_id where m.id=$1",
    [memberId],
  );
  return found;
}
async function latestConsent(db: DB, memberId: string) {
  const [consent] = await db.query<{ accepted: boolean }>(
    "select accepted from member_consents where member_id=$1 and consent_purpose='promotional_membership_sms' order by sequence desc limit 1",
    [memberId],
  );
  return consent?.accepted === true;
}
export async function queueMemberAccess(db: DB, accessId: string) {
  return queueMemberMessage(db, { accessId, purpose: "access" });
}
export type MemberDropInput = {
  memberId: string;
  accessId: string;
  allocationId: string;
  weekKey: string;
  sendAt?: string;
  expiresAt?: string;
  timezone?: string;
};
export async function queueMemberDrop(db: DB, input: MemberDropInput) {
  return queueMemberMessage(db, { ...input, purpose: "drop" });
}
async function queueMemberMessage(
  db: DB,
  input:
    | { accessId: string; purpose: "access" }
    | (MemberDropInput & { purpose: "drop" }),
) {
  return db.transaction((tx) => queueMemberMessageInTransaction(tx, input));
}
// Call only inside the caller's transaction, so credential creation and queueing commit together.
export async function queueMemberDropInTransaction(
  tx: DB,
  input: MemberDropInput,
) {
  return queueMemberMessageInTransaction(tx, { ...input, purpose: "drop" });
}
async function queueMemberMessageInTransaction(
  tx: DB,
  input:
    | { accessId: string; purpose: "access" }
    | (MemberDropInput & { purpose: "drop" }),
) {
  const environment = uptickEnvironment();
  if (!environment)
    throw new RequestError(
      "Set a valid Uptick environment before preparing membership messages.",
      503,
    );
  const [access] = await tx.query<Access>(
    "select * from member_access where id=$1",
    [input.accessId],
  );
  if (!access || access.purpose !== input.purpose)
    throw new RequestError(
      "This message needs a matching member access request.",
    );
  await tx.query("select id from uptick_members where id=$1 for update", [
    access.member_id,
  ]);
  const [existing] = await tx.query<MemberMessage>(
    "select * from member_messages where access_id=$1 and purpose=$2",
    [input.accessId, input.purpose],
  );
  if (existing) return existing;
  const owner = await member(tx, access.member_id);
  if (!owner) throw new RequestError("Member was not found.");
  if (new Date(access.expires_at) <= new Date())
    throw new RequestError("This access request has expired.");
  let sendAt = new Date(),
    expiresAt = new Date(access.expires_at);
  if (input.purpose === "drop") {
    if (
      input.memberId !== access.member_id ||
      owner.state !== "active" ||
      !owner.verified_at ||
      !(await latestConsent(tx, owner.id))
    )
      throw new RequestError(
        "Recurring Upticks require current verified membership consent.",
      );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.weekKey))
      throw new RequestError("Choose a valid Drop week.");
    // Allocation ownership and its saved week are checked in the network domain as well.
    const [allocation] = await tx.query<{
      member_id: string;
      week_key: string;
    }>("select member_id,week_key from member_allocations where id=$1", [
      input.allocationId,
    ]);
    if (
      !allocation ||
      allocation.member_id !== owner.id ||
      allocation.week_key !== input.weekKey
    )
      throw new RequestError(
        "This Drop allocation does not belong to this member and week.",
      );
    const [weekly] = await tx.query<MemberMessage>(
      "select * from member_messages where member_id=$1 and purpose='drop' and week_key=$2",
      [owner.id, input.weekKey],
    );
    if (weekly) return weekly;
    sendAt = input.sendAt ? new Date(input.sendAt) : sendAt;
    expiresAt = input.expiresAt
      ? new Date(
          Math.min(new Date(input.expiresAt).getTime(), expiresAt.getTime()),
        )
      : expiresAt;
    try {
      new Intl.DateTimeFormat("en-US", {
        timeZone: input.timezone || "America/New_York",
      }).format(sendAt);
    } catch {
      throw new RequestError("Choose a valid send time and time zone.");
    }
  }
  if (
    !Number.isFinite(sendAt.getTime()) ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt <= sendAt
  )
    throw new RequestError("The message must expire after its scheduled time.");
  const [sender] = await tx.query<Sender>(
    "select * from member_senders where active",
  );
  const [message] = await tx.query<MemberMessage>(
    `insert into member_messages(id,member_id,access_id,sender_id,purpose,allocation_id,week_key,timezone,scheduled_at,expires_at,environment) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [
      id(),
      owner.id,
      access.id,
      sender?.id || null,
      input.purpose,
      input.purpose === "drop" ? input.allocationId : null,
      input.purpose === "drop" ? input.weekKey : null,
      input.purpose === "drop"
        ? input.timezone || "America/New_York"
        : "America/New_York",
      sendAt.toISOString(),
      expiresAt.toISOString(),
      environment,
    ],
  );
  return message;
}
export async function memberMessageEligibility(
  db: DB,
  message: MemberMessage,
  now = new Date(),
) {
  if (message.environment !== uptickEnvironment())
    return "Message belongs to a different environment.";
  const owner = await member(db, message.member_id);
  if (!owner) return "Member was not found.";
  const block = smsEnvironmentBlock(owner.phone);
  if (block) return block;
  if (new Date(message.expires_at) <= now) return "Message window has expired.";
  if (new Date(message.scheduled_at) > now) return "not_started";
  const [access] = await db.query<Access>(
    "select * from member_access where id=$1 and member_id=$2",
    [message.access_id, owner.id],
  );
  if (
    !access ||
    access.purpose !== message.purpose ||
    new Date(access.expires_at) <= now
  )
    return "Member access has expired or does not match.";
  if (message.purpose === "access" && access.confirmed_at)
    return "Member access was already used.";
  const [globalSuppression] = await db.query<{ suppressed: boolean }>(
    "select suppressed from member_global_suppressions where phone=$1",
    [owner.phone],
  );
  if (globalSuppression?.suppressed) return "Uptick program opt-out.";
  const [suppression] = await db.query<{ suppressed: boolean }>(
    "select suppressed from member_suppressions where phone=$1 and sender_id=$2",
    [owner.phone, message.sender_id],
  );
  if (suppression?.suppressed) return "Uptick sender opt-out.";
  if (!simulatedTransport()) {
    const [sender] = await db.query<Sender>(
      "select * from member_senders where id=$1",
      [message.sender_id],
    );
    if (
      !sender?.active ||
      !sender.approved ||
      !messagingReady() ||
      !platformReadiness().ready
    )
      return "Uptick membership delivery is not ready.";
  }
  if (message.purpose === "drop") {
    if (
      owner.state !== "active" ||
      !owner.verified_at ||
      !(await latestConsent(db, owner.id))
    )
      return "No current verified Uptick membership consent.";
    if (weekKey(now, message.timezone) !== message.week_key)
      return "Drop week has passed.";
    if (isQuietHours(now, message.timezone)) return "quiet_hours";
    const [allocation] = await db.query<{
      member_id: string;
      week_key: string;
    }>("select member_id,week_key from member_allocations where id=$1", [
      message.allocation_id,
    ]);
    if (
      !allocation ||
      allocation.member_id !== owner.id ||
      allocation.week_key !== message.week_key
    )
      return "Drop allocation does not match.";
    if (
      (
        await db.query(
          "select claim_id from member_claims where allocation_id=$1",
          [message.allocation_id],
        )
      ).length
    )
      return "This week's Uptick has already been claimed.";
    const options = await db.query<{ supply_id: string }>(
      "select supply_id from allocation_options where allocation_id=$1",
      [message.allocation_id],
    );
    // The allocation/grant represents a backed obligation. Current unreserved
    // inventory eligibility must not hide it after a release reserved supply.
    if (!options.length)
      return "This week's Uptick is not backed by an allocation.";
  }
  return null;
}
export function memberMessageText(purpose: "access" | "drop", url: string) {
  return purpose === "access"
    ? `Uptick Local: Your requested secure access link: ${url} Open it to confirm your phone and review your membership choices. Reply STOP to stop texts. HELP for help.`
    : `Uptick Local: Your featured Uptick is ready. See this week's free local benefit: ${url} No purchase required. Reply STOP to stop promotional texts. HELP for help.`;
}
export async function dispatchMemberMessages(
  db: DB,
  limit = 20,
  send: MemberSmsProvider = provider,
  onlyMessageId?: string,
) {
  await db.query(
    "update member_messages set state='unknown',error_code='worker_interrupted',updated_at=now() where state='submitting' and updated_at<now()-interval '5 minutes'",
  );
  let processed = 0;
  const deferred: string[] = [];
  for (let i = 0; i < Math.min(100, Math.max(0, limit)); i++) {
    const job = await db.transaction(async (tx) => {
      const [candidate] = await tx.query<MemberMessage>(
        "select * from member_messages where state='queued' and not(id=any($1::text[])) and ($2::text is null or id=$2) order by scheduled_at,id limit 1",
        [deferred, onlyMessageId || null],
      );
      if (!candidate) return null;
      // Match the member-first order of consent/queue changes before locking the outbox.
      if (
        !(
          await tx.query(
            "select id from uptick_members where id=$1 for update skip locked",
            [candidate.member_id],
          )
        ).length
      )
        return { deferred: true, message: candidate };
      const [message] = await tx.query<MemberMessage>(
        "select * from member_messages where id=$1 and state='queued' for update skip locked",
        [candidate.id],
      );
      if (!message) return { deferred: true, message: candidate };
      const reason = await memberMessageEligibility(tx, message);
      if (reason === "quiet_hours" || reason === "not_started")
        return { deferred: true, message };
      if (reason) {
        await tx.query(
          "update member_messages set state='suppressed',suppression_reason=$2,updated_at=now() where id=$1",
          [message.id, reason],
        );
        return { skip: true, message };
      }
      await tx.query(
        "update member_messages set state=$2,updated_at=now() where id=$1",
        [message.id, simulatedTransport() ? "development" : "submitting"],
      );
      return { skip: simulatedTransport(), message };
    });
    if (!job) break;
    if ("deferred" in job) {
      deferred.push(job.message.id);
      continue;
    }
    const message = job.message;
    if (job.skip) {
      processed++;
      continue;
    }
    const reason = simulatedTransport()
      ? "Transport changed before provider submission."
      : await memberMessageEligibility(db, message);
    if (reason) {
      await db.query(
        "update member_messages set state=$2,suppression_reason=$3,updated_at=now() where id=$1 and state='submitting'",
        [
          message.id,
          ["quiet_hours", "not_started"].includes(reason)
            ? "queued"
            : "suppressed",
          reason,
        ],
      );
      processed++;
      continue;
    }
    const owner = await member(db, message.member_id);
    const [access] = await db.query<Access>(
      "select * from member_access where id=$1",
      [message.access_id],
    );
    const [sender] = await db.query<Sender>(
      "select * from member_senders where id=$1",
      [message.sender_id],
    );
    const body = memberMessageText(
      message.purpose,
      message.purpose === "access"
        ? `${appUrl()}/u/${decrypt(access.token_encrypted)}`
        : `${appUrl()}/your-uptick`,
    );
    try {
      await db.query(
        "update member_messages set rendered_body_encrypted=$2 where id=$1 and state='submitting'",
        [message.id, encrypt(body)],
      );
      const result = await send({
        to: owner.phone,
        messagingServiceSid: sender.service_sid,
        body,
        statusCallback: `${appUrl()}/api/member-twilio/status?message=${message.id}`,
      });
      if (!/^SM[0-9a-fA-F]{32}$/.test(result.sid))
        throw Error("Unrecognized provider result");
      await db.query(
        "update member_messages set provider_sid=$2,state=case when state='submitting' then 'provider_accepted' else state end,updated_at=now() where id=$1",
        [message.id, result.sid],
      );
    } catch (error) {
      const value = error as { status?: number; code?: number };
      const definitive =
        typeof value.status === "number" &&
        value.status >= 400 &&
        value.status < 500;
      await db.query(
        "update member_messages set state=$2,error_code=$3,updated_at=now() where id=$1 and state='submitting'",
        [
          message.id,
          definitive ? "failed" : "unknown",
          typeof value.code === "number"
            ? String(value.code)
            : "provider_outcome_uncertain",
        ],
      );
    }
    processed++;
  }
  return processed;
}
export async function dispatchRequestedMemberAccess(db: DB, messageId: string) {
  const [message] = await db.query<MemberMessage>(
    "select * from member_messages where id=$1 and purpose='access'",
    [messageId],
  );
  if (!message)
    throw new RequestError("Requested access message was not found.");
  await dispatchMemberMessages(db, 1, provider, message.id);
  return (
    await db.query<MemberMessage>("select * from member_messages where id=$1", [
      message.id,
    ])
  )[0];
}
const rank: Record<string, number> = {
  submitting: 0,
  unknown: 0,
  provider_accepted: 1,
  sent: 2,
  failed: 3,
  undelivered: 3,
  delivered: 4,
};
export async function memberMessageStatus(
  db: DB,
  messageId: string,
  sid: string,
  status: string,
  errorCode?: string,
) {
  if (!/^SM[0-9a-fA-F]{32}$/.test(sid))
    throw new RequestError("Invalid provider message.");
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
  const state = ["accepted", "queued", "sending"].includes(status)
    ? "provider_accepted"
    : status;
  await db.transaction(async (tx) => {
    const [message] = await tx.query<MemberMessage>(
      "select * from member_messages where id=$1 for update",
      [messageId],
    );
    if (
      !message ||
      !(message.state in rank) ||
      (message.provider_sid && message.provider_sid !== sid)
    )
      throw new RequestError("Unknown submitted member message.");
    const code = errorCode && /^\d{1,8}$/.test(errorCode) ? errorCode : null;
    const added = await tx.query(
      "insert into member_message_events(id,message_id,provider_sid,state,error_code) values($1,$2,$3,$4,$5) on conflict(provider_sid,state) do nothing returning id",
      [id(), message.id, sid, state, code],
    );
    if (!added.length) return;
    if (rank[state] > rank[message.state])
      await tx.query(
        "update member_messages set state=$2,provider_sid=$3,error_code=$4,updated_at=now() where id=$1",
        [message.id, state, sid, code],
      );
    else if (!message.provider_sid)
      await tx.query("update member_messages set provider_sid=$2 where id=$1", [
        message.id,
        sid,
      ]);
  });
}
export async function memberInbound(db: DB, fields: Record<string, string>) {
  if (
    !/^SM[0-9a-fA-F]{32}$/.test(fields.MessageSid || "") ||
    !/^\+1\d{10}$/.test(fields.From || "")
  )
    throw new RequestError("Invalid inbound member message.");
  const action = (fields.OptOutType || fields.Body || "").trim().toUpperCase();
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
  const result = await db.transaction(async (tx) => {
    const [sender] = fields.MessagingServiceSid
      ? await tx.query<Sender>(
          "select * from member_senders where service_sid=$1",
          [fields.MessagingServiceSid],
        )
      : await tx.query<Sender>("select * from member_senders where phone=$1", [
          fields.To || "",
        ]);
    if (!sender) throw new RequestError("Unknown Uptick membership sender.");
    const [owner] = await tx.query<Member>(
      "select m.id,m.state,m.verified_at,c.phone from uptick_members m join customers c on c.id=m.customer_id where c.phone=$1 for update of m",
      [fields.From],
    );
    const inserted = await tx.query(
      "insert into member_inbound_events(provider_sid,sender_id,action) values($1,$2,$3) on conflict do nothing returning provider_sid",
      [fields.MessageSid, sender.id, normalized],
    );
    if (!inserted.length)
      return {
        action: normalized,
        reply:
          normalized === "HELP"
            ? memberHelpReply()
            : "Uptick Local received your message. A support person will review it.",
      };
    if (normalized === "STOP" || normalized === "START") {
      await tx.query(
        "insert into member_suppressions(phone,sender_id,suppressed) values($1,$2,$3) on conflict(phone,sender_id) do update set suppressed=excluded.suppressed,updated_at=now()",
        [fields.From, sender.id, normalized === "STOP"],
      );
      await tx.query(
        "insert into member_global_suppressions(phone,suppressed,source_sender_id) values($1,$2,$3) on conflict(phone) do update set suppressed=excluded.suppressed,source_sender_id=excluded.source_sender_id,updated_at=now()",
        [fields.From, normalized === "STOP", sender.id],
      );
      if (normalized === "STOP" && owner) {
        await recordMemberConsent(
          tx,
          owner.id,
          false,
          "twilio-membership-inbound",
          "STOP received for Uptick Local promotional membership texts.",
          "stop",
        );
        await tx.query(
          "update member_messages set state='suppressed',suppression_reason='Uptick program opt-out.',updated_at=now() where member_id=$1 and state='queued'",
          [owner.id],
        );
      }
      // START changes carrier suppression only. A fresh explicit consent action must resume membership.
    }
    if (normalized === "HELP" || normalized === "OTHER") {
      const [allocation] = owner
        ? await tx.query<{ id: string; week_key: string }>(
            "select id,week_key from member_allocations where member_id=$1 order by created_at desc limit 1",
            [owner.id],
          )
        : [];
      await tx.query(
        `insert into member_support_requests(id,member_id,provider_sid,sender_id,origin,phone_encrypted,body_encrypted,context)
         values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id(),
          owner?.id || null,
          fields.MessageSid,
          sender.id,
          normalized === "HELP" ? "sms_help" : "sms_other",
          encrypt(fields.From),
          encrypt((fields.Body || "").slice(0, 2000)),
          {
            membershipState: owner?.state || "unknown",
            verified: !!owner?.verified_at,
            allocationId: allocation?.id || null,
            weekKey: allocation?.week_key || null,
          },
        ],
      );
    }
    return {
      action: normalized,
      reply:
        normalized === "STOP"
          ? "Uptick Local promotional texts are stopped. Your membership and any issued Uptick stay active."
          : normalized === "START"
            ? "Carrier blocking is cleared. Promotional texts remain off until you opt in again in Your Uptick preferences."
            : normalized === "HELP"
              ? memberHelpReply()
              : "Uptick Local received your message. A support person will review it.",
    };
  });
  return result;
}

function memberHelpReply() {
  const support = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    process.env.SUPPORT_EMAIL || "",
  )
    ? ` Email ${process.env.SUPPORT_EMAIL}.`
    : "";
  return `Uptick Local help: open ${appUrl()}/your-uptick for your benefit and preferences.${support} Reply STOP to stop promotional texts.`;
}
export async function verifyMemberWebhook(request: Request, kind: string) {
  if (!["inbound", "status"].includes(kind))
    throw new RequestError("Unknown callback.", 404);
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/x-www-form-urlencoded"
  )
    throw new RequestError("Unsupported content type.", 415);
  const url = new URL(request.url),
    fields = Object.fromEntries(new URLSearchParams(await readBody(request)));
  if (
    !process.env.TWILIO_AUTH_TOKEN ||
    fields.AccountSid !== process.env.TWILIO_ACCOUNT_SID ||
    !twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      request.headers.get("x-twilio-signature") || "",
      `${appUrl()}/api/member-twilio/${kind}${url.search}`,
      fields,
    )
  )
    throw new RequestError("Invalid provider signature or account.", 403);
  return { fields, messageId: url.searchParams.get("message") || "" };
}
