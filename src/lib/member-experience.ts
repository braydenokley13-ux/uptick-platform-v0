import type { DB } from "./db";
import { memberServiceStatus } from "./member-service";
import { id, token, hash, encrypt, decrypt, maskPhone } from "./security";
import { audit, authorize, weekKey, type Actor } from "./domain";
import { RequestError } from "./http";
import {
  allocationView,
  memberAccess,
  demandEvent,
  supplySelect,
  supplyUsage,
  MEMBERSHIP_DISCLOSURE,
  type Supply,
  type Member,
} from "./network";
import {
  memberMessagingReadiness,
  queueMemberDropInTransaction,
} from "./member-messaging";
import { stagingRecipients, uptickEnvironment } from "./environment";

export type MemberOutstandingRecovery = {
  id: string;
  state: "issued";
  expires_at: string;
  issued_at: string;
  member_snapshot: {
    merchant?: string;
    address?: string;
    exact_item?: string;
    size_label?: string;
    usable_hours?: string;
    instructions?: string;
  };
  original_claim_id: string;
  original_grant_id: string;
  token_encrypted: string;
  week_key: string;
  current_week: boolean;
};

export async function memberIncidentGrant(
  db: DB,
  memberId: string,
  grantId: string,
) {
  const [grant] = await db.query<{ id: string }>(
    "select id from fulfillment_grants where id=$1 and member_id=$2",
    [grantId, memberId],
  );
  if (!grant)
    throw new RequestError(
      "This issued benefit is not attached to your membership.",
      404,
    );
  return grant.id;
}

export async function memberHome(
  db: DB,
  credential: string,
  asOf = new Date(),
) {
  const viewedAt = asOf.toISOString();
  const identity = await memberAccess(db, credential);
  const serviceStatus = await memberServiceStatus(db, identity.member.id);
  if (!identity.access.confirmed_at)
    return {
      ...identity,
      serviceStatus,
      current: null,
      saved: null,
      shareableSupplyId: undefined,
      history: [],
      outstandingRecoveries: [] as MemberOutstandingRecovery[],
      market: null,
      marketingSubscribed: false,
      marketingConsentAction: null,
      admission: { state: "unavailable" as const },
    };
  const [consent] = await db.query<{
    accepted: boolean;
    consent_action: string;
  }>(
    "select accepted,consent_action from member_consents where member_id=$1 and consent_purpose='promotional_membership_sms' order by sequence desc limit 1",
    [identity.member.id],
  );
  const [allocation] = await db.query<{
    id: string;
    member_id: string;
    market_id: string;
    week_key: string;
    created_at: string;
  }>(
    `select a.* from member_allocations a join market_cells k on k.id=a.market_id
     where a.member_id=$1 and a.week_key=to_char(date_trunc('week',$2::timestamptz at time zone k.timezone),'YYYY-MM-DD')
     order by a.created_at desc limit 1`,
    [identity.member.id, viewedAt],
  );
  // This is a read-only account view. Allocation/release is an operator action,
  // and reserved supply remains visible even after unreserved stock is exhausted.
  const current = allocation ? await allocationView(db, allocation) : null;
  const history = await db.query<{
    id: string;
    state: "active" | "redeemed" | "invalidated";
    created_at: string;
    redeemed_at: string | null;
    token_encrypted: string;
    offer_id: string;
    reserved_until: string | null;
    snapshot: {
      merchant: string;
      reward: string;
      expires_at: string;
      timezone: string;
    };
    method: string | null;
    current_week: boolean;
  }>(
    `select c.*,mc.reserved_until,e.method,a.week_key=to_char(date_trunc('week',$2::timestamptz at time zone k.timezone),'YYYY-MM-DD') current_week from member_claims mc join claims c on c.id=mc.claim_id join member_allocations a on a.id=mc.allocation_id join market_cells k on k.id=a.market_id left join redemption_evidence e on e.claim_id=c.id where mc.member_id=$1 order by c.created_at desc,c.id desc limit 20`,
    [identity.member.id, viewedAt],
  );
  // Recovery belongs to the original pass, even when that pass came from an
  // earlier week. This authenticated account query intentionally returns the
  // encrypted pass credential only to the server-rendered member page.
  const outstandingRecoveries = await db.query<MemberOutstandingRecovery>(
    `select r.id,r.state,r.expires_at,r.issued_at,r.member_snapshot,
            r.original_claim_id,r.original_grant_id,c.token_encrypted,a.week_key,
            a.week_key=to_char(date_trunc('week',$2::timestamptz at time zone k.timezone),'YYYY-MM-DD') current_week
       from recovery_grants r
       join member_claims mc on mc.claim_id=r.original_claim_id
        and mc.member_id=r.member_id and mc.grant_id=r.original_grant_id
       join claims c on c.id=mc.claim_id
       join member_allocations a on a.id=mc.allocation_id
       join market_cells k on k.id=a.market_id
      where r.member_id=$1 and r.superseded_at is null and r.state='issued' and r.expires_at>$2::timestamptz
      order by r.issued_at desc,r.id desc limit 10`,
    [identity.member.id, viewedAt],
  );
  const [market] = await db.query<{
    name: string;
    timezone: string;
    state: string;
  }>("select name,timezone,state from market_cells where id=$1", [
    identity.member.market_id,
  ]);
  const [admission] = await db.query<{
    state: "admitted" | "waitlisted";
    run_id: string;
    run_name: string;
  }>(
    `select 'admitted'::text state,a.run_id,r.name run_name
       from pilot_admissions a join pilot_runs r on r.id=a.run_id
      where a.member_id=$1 and r.state<>'complete'
     union all
     select 'waitlisted'::text state,w.run_id,r.name run_name
       from pilot_waitlist w join pilot_runs r on r.id=w.run_id
      where w.member_id=$1 and r.state<>'complete'
     order by state limit 1`,
    [identity.member.id],
  );
  const saved = history.find((claim) => claim.current_week) || null;
  const shareable = saved
    ? current?.options.find((option) => option.offer_id === saved.offer_id)
    : current?.options[0];
  return {
    ...identity,
    serviceStatus,
    current,
    saved,
    shareableSupplyId: shareable?.shareable ? shareable.id : undefined,
    history,
    outstandingRecoveries,
    market: market || null,
    marketingSubscribed: consent?.accepted === true,
    marketingConsentAction: consent?.consent_action || null,
    admission: admission || { state: "unavailable" as const },
  };
}

export async function createMemberSupportRequest(
  db: DB,
  credential: string,
  message?: string,
) {
  const { member } = await memberAccess(db, credential, true);
  const [context] = await db.query<{
    phone: string;
    allocation_id: string | null;
    claim_id: string | null;
    week_key: string | null;
  }>(
    `select c.phone,a.id allocation_id,mc.claim_id,a.week_key
       from uptick_members m join customers c on c.id=m.customer_id
       left join member_allocations a on a.member_id=m.id
       left join member_claims mc on mc.allocation_id=a.id
      where m.id=$1 order by a.created_at desc limit 1`,
    [member.id],
  );
  await db.query(
    `insert into member_support_requests(id,member_id,origin,phone_encrypted,body_encrypted,context)
     values($1,$2,'member_web',$3,$4,$5)`,
    [
      id(),
      member.id,
      context?.phone ? encrypt(context.phone) : null,
      message ? encrypt(message) : null,
      {
        membershipState: member.state,
        verified: !!member.verified_at,
        allocationId: context?.allocation_id || null,
        claimId: context?.claim_id || null,
        weekKey: context?.week_key || null,
      },
    ],
  );
}

export async function memberSupportQueue(db: DB, actor: Actor) {
  authorize(actor, actor.organizationId, true);
  const rows = await db.query<{
    id: string;
    member_id: string | null;
    origin: string;
    body_encrypted: string | null;
    context: Record<string, unknown>;
    state: string;
    created_at: string;
    phone: string | null;
    membership_state: string | null;
    verified_at: string | null;
    marketing_consent: boolean | null;
    message_state: string | null;
    rendered_body_encrypted: string | null;
    grant_id: string | null;
    incident_id: string | null;
    recovery_id: string | null;
  }>(
    `select q.*,c.phone,m.state membership_state,m.verified_at,
      (select accepted from member_consents x where x.member_id=m.id and x.consent_purpose='promotional_membership_sms' order by x.sequence desc limit 1) marketing_consent,
      (select mm.state from member_messages mm where mm.member_id=m.id order by mm.created_at desc limit 1) message_state,
      (select mm.rendered_body_encrypted from member_messages mm where mm.member_id=m.id order by mm.created_at desc limit 1) rendered_body_encrypted,
      (select g.id from fulfillment_grants g where g.member_id=m.id order by g.created_at desc limit 1) grant_id,
      (select i.id from fulfillment_incidents i where i.member_id=m.id order by i.created_at desc limit 1) incident_id,
      (select r.id from recovery_grants r where r.member_id=m.id order by r.issued_at desc limit 1) recovery_id
      from member_support_requests q
      left join uptick_members m on m.id=q.member_id
      left join customers c on c.id=m.customer_id
      where q.state in ('queued','working') order by q.created_at limit 100`,
  );
  const reveal = (value: string | null) => {
    if (!value) return null;
    try {
      return decrypt(value);
    } catch {
      return "[Encrypted content could not be opened]";
    }
  };
  const redactCredentials = (value: string | null) =>
    value
      ? value.replace(
          /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
          "[private credential redacted]",
        )
      : null;
  return rows.map((row) => ({
    id: row.id,
    memberReference: row.member_id
      ? `UP-${row.member_id.slice(-6).toUpperCase()}`
      : null,
    phoneHint: row.phone ? maskPhone(row.phone) : null,
    origin: row.origin,
    note: redactCredentials(reveal(row.body_encrypted)),
    context: row.context,
    state: row.state,
    createdAt: row.created_at,
    membership: {
      state: row.membership_state,
      verified: !!row.verified_at,
      marketingConsent: row.marketing_consent === true,
    },
    latestMessage: {
      state: row.message_state,
      text: redactCredentials(reveal(row.rendered_body_encrypted)),
      privateLinkRedacted: /\b[A-Za-z0-9_-]{43}\b/.test(
        reveal(row.rendered_body_encrypted) || "",
      ),
    },
    grantId: row.grant_id,
    incidentId: row.incident_id,
    recoveryId: row.recovery_id,
  }));
}

export async function resolveMemberSupportRequest(
  db: DB,
  actor: Actor,
  requestId: string,
  resolution: string,
) {
  authorize(actor, actor.organizationId, true);
  const note = resolution.trim();
  if (note.length < 3 || note.length > 1000)
    throw new RequestError(
      "Record how the member support request was resolved.",
    );
  await db.transaction(async (tx) => {
    const [request] = await tx.query<{ id: string; state: string }>(
      "select id,state from member_support_requests where id=$1 for update",
      [requestId],
    );
    if (!request)
      throw new RequestError("Choose an existing member support request.", 404);
    if (!["resolved", "closed"].includes(request.state))
      await tx.query(
        "update member_support_requests set state='resolved',resolved_at=now(),resolved_by=$2,resolution_encrypted=$3 where id=$1",
        [request.id, actor.id, encrypt(note)],
      );
    await audit(tx, actor.id, null, "membership.support_resolved", request.id, {
      priorState: request.state,
      resolutionRecorded: true,
    });
  });
}
export async function shareUptick(
  db: DB,
  credential: string,
  supplyId?: string,
) {
  return db.transaction(async (tx) => {
    const initial = await memberAccess(tx, credential, true);
    await tx.query("select id from uptick_members where id=$1 for update", [
      initial.member.id,
    ]);
    const { member } = await memberAccess(tx, credential, true);
    const [market] = await tx.query<{ timezone: string }>(
      "select timezone from market_cells where id=$1 and state in ('pilot','live')",
      [member.market_id],
    );
    if (member.state !== "active" || !member.verified_at || !market)
      throw new RequestError(
        "Your membership needs an active local market before inviting a friend.",
      );
    let supply: Supply | undefined;
    if (supplyId) {
      [supply] = await tx.query<Supply>(
        `${supplySelect} where s.id=$1 and ml.active`,
        [supplyId],
      );
      if (
        !supply ||
        !supply.shareable ||
        supply.referral_cap < 1 ||
        supply.market_id !== member.market_id ||
        supply.state !== "approved" ||
        new Date(supply.starts_at) > new Date() ||
        new Date(supply.expires_at) <= new Date()
      )
        throw new RequestError("This Drop is not available to share.");
      const [offered] = await tx.query(
        "select 1 from allocation_options o join member_allocations a on a.id=o.allocation_id where a.member_id=$1 and a.week_key=$3 and o.supply_id=$2",
        [member.id, supplyId, weekKey(new Date(), market.timezone)],
      );
      if (!offered)
        throw new RequestError("Share a Drop from your Uptick choices.");
      const usage = await supplyUsage(tx, supplyId);
      if (usage.remaining !== null && usage.remaining < 1)
        throw new RequestError("This Drop has reached its available quantity.");
    }
    const [existing] = await tx.query<{ public_token: string }>(
      "select public_token from member_referrals where member_id=$1 and market_id=$3 and supply_id is not distinct from $2 and expires_at>now() order by created_at desc limit 1",
      [member.id, supplyId || null, member.market_id],
    );
    if (existing) return existing.public_token;
    const publicToken = token();
    await tx.query(
      "insert into member_referrals(id,member_id,supply_id,public_token,max_joins,expires_at,market_id) values($1,$2,$3,$4,$5,$6,$7)",
      [
        id(),
        member.id,
        supplyId || null,
        publicToken,
        supply?.referral_cap || 5,
        supply?.expires_at ||
          new Date(Date.now() + 30 * 86400000).toISOString(),
        member.market_id,
      ],
    );
    await demandEvent(tx, {
      kind: "referral_link_created",
      memberId: member.id,
      marketId: member.market_id,
      supplyId: supplyId || null,
      detail: { inventoryReserved: false, cap: supply?.referral_cap || 5 },
    });
    return publicToken;
  });
}
type Referral = {
  id: string;
  member_id: string;
  supply_id: string | null;
  max_joins: number;
  market_id: string;
  market: string;
  joins: number;
};
async function availableReferral(db: DB, publicToken: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(publicToken))
    throw new RequestError("This invitation is unavailable.", 404);
  const [referral] = await db.query<Referral>(
    "select r.id,r.member_id,r.supply_id,r.max_joins,r.market_id,k.name market,(select count(*)::int from referral_joins j where j.referral_id=r.id) joins from member_referrals r join market_cells k on k.id=r.market_id where r.public_token=$1 and r.expires_at>now() and k.state in ('pilot','live')",
    [publicToken],
  );
  if (!referral || referral.joins >= referral.max_joins)
    throw new RequestError(
      "This invitation has reached its limit or ended.",
      404,
    );
  return referral;
}
export async function referralLanding(db: DB, publicToken: string) {
  const saved = await availableReferral(db, publicToken);
  let [supply]: (Supply | undefined)[] = saved.supply_id
    ? await db.query<Supply>(
        `${supplySelect} where s.id=$1 and s.market_id=$2 and s.state='approved' and s.shareable and ml.active and s.starts_at<=now() and s.expires_at>now()`,
        [saved.supply_id, saved.market_id],
      )
    : [];
  if (supply) {
    const usage = await supplyUsage(db, supply.id);
    if (usage.remaining !== null && usage.remaining < 1) supply = undefined;
  }
  // A public invitation reveals its market and perk, never its member owner's identity.
  const referral = {
    id: saved.id,
    supply_id: saved.supply_id,
    max_joins: saved.max_joins,
    market_id: saved.market_id,
    market: saved.market,
    joins: saved.joins,
  };
  return { referral, supply };
}
export async function acceptReferral(
  db: DB,
  credential: string,
  publicToken: string,
) {
  return db.transaction(async (tx) => {
    const initial = await memberAccess(tx, credential, true);
    await tx.query("select id from uptick_members where id=$1 for update", [
      initial.member.id,
    ]);
    const { member, access } = await memberAccess(tx, credential, true);
    const [intent] = await tx.query<{ referral_id: string }>(
      "select i.referral_id from access_referral_intents i join member_first_verifications v on v.member_id=i.member_id and v.access_id=i.access_id join member_referrals r on r.id=i.referral_id where i.access_id=$1 and i.member_id=$2 and r.public_token=$3",
      [access.id, member.id, publicToken],
    );
    // Existing members may open a shared invitation, but are never counted as new acquisitions.
    if (!intent || member.state !== "active") return;
    await tx.query("select id from member_referrals where id=$1 for update", [
      intent.referral_id,
    ]);
    if (
      (
        await tx.query(
          "select member_id from referral_joins where member_id=$1",
          [member.id],
        )
      ).length
    )
      return;
    const referral = await availableReferral(tx, publicToken);
    if (referral.member_id === member.id)
      throw new RequestError("This invitation is for someone new to Uptick.");
    if (member.market_id !== referral.market_id)
      throw new RequestError(
        "This invitation is for a different local market.",
      );
    const [joined] = await tx.query<{ member_id: string }>(
      "insert into referral_joins(referral_id,member_id) values($1,$2) on conflict(member_id) do nothing returning member_id",
      [referral.id, member.id],
    );
    if (joined)
      await demandEvent(tx, {
        kind: "referral_joined",
        memberId: member.id,
        marketId: member.market_id,
        supplyId: referral.supply_id,
        detail: { referralId: referral.id, inventoryReserved: false },
        dedupKey: `referral-joined:${member.id}`,
      });
  });
}
export async function acceptPendingReferral(db: DB, credential: string) {
  const { access, member } = await memberAccess(db, credential, true);
  const [intent] = await db.query<{ public_token: string }>(
    "select r.public_token from access_referral_intents i join member_referrals r on r.id=i.referral_id where i.access_id=$1 and i.member_id=$2",
    [access.id, member.id],
  );
  if (!intent) return { attributed: false, status: "not_requested" as const };
  try {
    await acceptReferral(db, credential, intent.public_token);
    const [joined] = await db.query(
      "select member_id from referral_joins where member_id=$1",
      [member.id],
    );
    return {
      attributed: !!joined,
      status: joined ? ("accepted" as const) : ("not_eligible" as const),
    };
  } catch (error) {
    if (error instanceof RequestError)
      return { attributed: false, status: "unavailable" as const };
    throw error;
  }
}

// One bounded page per invocation. Failed supply attempts move behind unattempted members.
export async function prepareMembershipWeek(db: DB, limit = 100) {
  if (!(await memberMessagingReadiness(db)).ready) return 0;
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(250, Math.max(1, Math.floor(limit)))
    : 100;
  const recipients =
    uptickEnvironment() === "staging" && process.env.SMS_TRANSPORT === "twilio"
      ? stagingRecipients()
      : null;
  const members = await db.query<
    Member & { timezone: string; week_key: string; allocation_id: string }
  >(
    `select m.*,k.timezone,a.week_key,a.id allocation_id
       from member_allocations a
       join uptick_members m on m.id=a.member_id
       join market_cells k on k.id=a.market_id
       join customers c on c.id=m.customer_id
       left join member_week_preparations p on p.member_id=m.id and p.week_key=a.week_key
      where a.week_key=to_char(date_trunc('week',now() at time zone k.timezone),'YYYY-MM-DD')
        and m.state='active' and m.verified_at is not null
        and coalesce((select accepted from member_consents mc where mc.member_id=m.id and mc.consent_purpose='promotional_membership_sms' order by mc.sequence desc limit 1),false)
        and ($2::text[] is null or c.phone=any($2::text[]))
        and not exists(select 1 from member_messages msg where msg.member_id=m.id and msg.purpose='drop' and msg.week_key=a.week_key)
        and not exists(select 1 from member_claims chosen where chosen.allocation_id=a.id)
        and (p.next_attempt_at is null or p.next_attempt_at<=now())
      order by p.attempted_at nulls first,a.created_at,a.id limit $1`,
    [boundedLimit, recipients],
  );
  let prepared = 0;
  for (const candidate of members) {
    const result = await db.transaction(async (tx) => {
      const [member] = await tx.query<Member>(
        "select * from uptick_members where id=$1 for update skip locked",
        [candidate.id],
      );
      if (!member) return false;
      if (
        (
          await tx.query(
            "select id from member_messages where member_id=$1 and week_key=$2 and purpose='drop'",
            [member.id, candidate.week_key],
          )
        ).length
      )
        return false;
      const mark = async (
        state: string,
        reason: string | null,
        messageId: string | null = null,
      ) =>
        tx.query(
          "insert into member_week_preparations(member_id,week_key,state,next_attempt_at,message_id,reason) values($1,$2,$3,now()+interval '15 minutes',$4,$5) on conflict(member_id,week_key) do update set state=excluded.state,attempted_at=now(),next_attempt_at=excluded.next_attempt_at,message_id=excluded.message_id,reason=excluded.reason",
          [member.id, candidate.week_key, state, messageId, reason],
        );
      const [consent] = await tx.query<{ accepted: boolean }>(
        "select accepted from member_consents where member_id=$1 and consent_purpose='promotional_membership_sms' order by sequence desc limit 1",
        [member.id],
      );
      const [savedAllocation] = await tx.query<{
        id: string;
        member_id: string;
        market_id: string;
        week_key: string;
        created_at: string;
      }>(
        "select * from member_allocations where id=$1 and member_id=$2 and week_key=$3",
        [candidate.allocation_id, member.id, candidate.week_key],
      );
      const allocation = savedAllocation
        ? await allocationView(tx, savedAllocation)
        : null;
      if (
        member.state !== "active" ||
        !member.verified_at ||
        !consent?.accepted ||
        member.market_id !== allocation?.allocation.market_id
      ) {
        await mark(
          allocation ? "blocked" : "waiting_supply",
          allocation
            ? "Messaging permission changed."
            : "No released Uptick is available.",
        );
        return false;
      }
      if (
        !allocation?.options.length ||
        allocation.allocation.week_key !== candidate.week_key
      ) {
        await mark("waiting_supply", "No released Uptick is available.");
        return false;
      }
      if (
        (
          await tx.query(
            "select claim_id from member_claims where allocation_id=$1",
            [allocation.allocation.id],
          )
        ).length
      ) {
        await mark(
          "blocked",
          "This member already chose their Uptick this week.",
        );
        return false;
      }
      const available = allocation.options;
      const expiry = new Date(
        Math.max(
          ...available.map((supply) => new Date(supply.expires_at).getTime()),
        ),
      );
      const privateToken = token(),
        accessId = id();
      await tx.query(
        "insert into member_access(id,member_id,token_hash,token_encrypted,purpose,expires_at,age_attested,disclosure,home_zip,work_zip) values($1,$2,$3,$4,'drop',$5,true,$6,$7,$8)",
        [
          accessId,
          member.id,
          hash(privateToken),
          encrypt(privateToken),
          expiry.toISOString(),
          MEMBERSHIP_DISCLOSURE,
          member.home_zip,
          member.work_zip,
        ],
      );
      const message = await queueMemberDropInTransaction(tx, {
        memberId: member.id,
        accessId,
        allocationId: allocation.allocation.id,
        weekKey: candidate.week_key,
        expiresAt: expiry.toISOString(),
        timezone: candidate.timezone,
      });
      await mark("queued", null, message.id);
      return true;
    });
    if (result) prepared++;
  }
  return prepared;
}
