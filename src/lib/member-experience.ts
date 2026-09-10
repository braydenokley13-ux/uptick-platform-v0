import type { DB } from "./db";
import { id, token, hash, encrypt } from "./security";
import { weekKey } from "./domain";
import { RequestError } from "./http";
import {
  allocateMember,
  eligibleDrops,
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

export async function memberHome(db: DB, credential: string) {
  const identity = await memberAccess(db, credential);
  if (!identity.access.confirmed_at)
    return {
      ...identity,
      current: null,
      saved: null,
      history: [],
      market: null,
    };
  const [consent] = await db.query<{ accepted: boolean }>(
    "select accepted from member_consents where member_id=$1 order by sequence desc limit 1",
    [identity.member.id],
  );
  const allocated =
    identity.member.state === "active" && consent?.accepted
      ? await allocateMember(db, identity.member.id)
      : null;
  const eligible = new Set(
    (await eligibleDrops(db, identity.member.id)).map((supply) => supply.id),
  );
  const options = (allocated?.options || []).filter((option) =>
    eligible.has(option.id),
  );
  const current = allocated ? { ...allocated, options } : null;
  const history = await db.query<{
    id: string;
    state: string;
    created_at: string;
    redeemed_at: string | null;
    token_encrypted: string;
    snapshot: { merchant: string; reward: string; expires_at: string };
    method: string | null;
    current_week: boolean;
  }>(
    `select c.*,e.method,a.week_key=to_char(date_trunc('week',now() at time zone k.timezone),'YYYY-MM-DD') current_week from member_claims mc join claims c on c.id=mc.claim_id join member_allocations a on a.id=mc.allocation_id join market_cells k on k.id=a.market_id left join redemption_evidence e on e.claim_id=c.id where mc.member_id=$1 order by c.created_at desc,c.id desc limit 20`,
    [identity.member.id],
  );
  const [market] = await db.query<{ name: string; timezone: string }>(
    "select name,timezone from market_cells where id=$1",
    [identity.member.market_id],
  );
  return {
    ...identity,
    current,
    saved: history.find((claim) => claim.current_week) || null,
    history,
    market: market || null,
  };
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
    const [consent] = await tx.query<{ accepted: boolean }>(
      "select accepted from member_consents where member_id=$1 order by sequence desc limit 1",
      [member.id],
    );
    if (
      member.state !== "active" ||
      !member.verified_at ||
      !consent?.accepted ||
      !market
    )
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
    const [consent] = await tx.query<{ accepted: boolean }>(
      "select accepted from member_consents where member_id=$1 order by sequence desc limit 1",
      [member.id],
    );
    if (!consent?.accepted) return;
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
    Member & { timezone: string; week_key: string }
  >(
    `select m.*,k.timezone,to_char(date_trunc('week',now() at time zone k.timezone),'YYYY-MM-DD') week_key from uptick_members m join market_cells k on k.id=m.market_id join customers c on c.id=m.customer_id left join member_week_preparations p on p.member_id=m.id and p.week_key=to_char(date_trunc('week',now() at time zone k.timezone),'YYYY-MM-DD') where m.state='active' and m.verified_at is not null and k.state in ('pilot','live') and coalesce((select accepted from member_consents mc where mc.member_id=m.id order by mc.sequence desc limit 1),false) and ($2::text[] is null or c.phone=any($2::text[])) and not exists(select 1 from member_messages msg where msg.member_id=m.id and msg.purpose='drop' and msg.week_key=to_char(date_trunc('week',now() at time zone k.timezone),'YYYY-MM-DD')) and not exists(select 1 from member_claims chosen join member_allocations chosen_week on chosen_week.id=chosen.allocation_id where chosen.member_id=m.id and chosen_week.week_key=to_char(date_trunc('week',now() at time zone k.timezone),'YYYY-MM-DD')) and (p.next_attempt_at is null or p.next_attempt_at<=now()) order by p.attempted_at nulls first,m.created_at,m.id limit $1`,
    [boundedLimit, recipients],
  );
  let prepared = 0;
  for (const candidate of members) {
    const allocation = await allocateMember(db, candidate.id);
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
        "select accepted from member_consents where member_id=$1 order by sequence desc limit 1",
        [member.id],
      );
      if (
        member.state !== "active" ||
        !member.verified_at ||
        !consent?.accepted ||
        member.market_id !== allocation?.allocation.market_id
      ) {
        await mark(
          allocation ? "blocked" : "waiting_supply",
          allocation
            ? "Membership eligibility changed."
            : "No eligible supply is available.",
        );
        return false;
      }
      if (
        !allocation?.options.length ||
        allocation.allocation.week_key !== candidate.week_key
      ) {
        await mark("waiting_supply", "No eligible supply is available.");
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
      // Eligibility may change between allocation and this queue transaction.
      // Recheck geography, market state, consent, prior claims and inventory together.
      const currentlyEligible = new Set(
        (await eligibleDrops(tx, member.id)).map((supply) => supply.id),
      );
      const available = allocation.options.filter((option) =>
        currentlyEligible.has(option.id),
      );
      if (!available.length) {
        await mark(
          "waiting_supply",
          "The allocated choices currently have no available supply.",
        );
        return false;
      }
      const expiry = new Date(
        Math.max(
          ...available.map((supply) => new Date(supply.expires_at).getTime()),
        ),
      );
      const privateToken = token(),
        accessId = id();
      await tx.query(
        "insert into member_access(id,member_id,token_hash,token_encrypted,purpose,expires_at,disclosure,home_zip,work_zip) values($1,$2,$3,$4,'drop',$5,$6,$7,$8)",
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
