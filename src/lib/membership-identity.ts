import type { DB } from "./db";
import { rateLimit } from "./domain";
import { id, token, hash, encrypt, normalizePhone } from "./security";
import { RequestError } from "./http";
import { demandEvent } from "./demand-events";

export const MEMBERSHIP_DISCLOSURE_VERSION = "uptick-membership-2026-09-v1";
import { MEMBERSHIP_DISCLOSURE } from "./membership-copy";
export { MEMBERSHIP_DISCLOSURE } from "./membership-copy";
export type Member = {
  id: string;
  customer_id: string;
  home_zip: string;
  work_zip: string | null;
  market_id: string | null;
  source_id: string | null;
  state: "pending" | "active" | "paused";
  verified_at: string | null;
  created_at: string;
};
export type Access = {
  id: string;
  member_id: string;
  token_encrypted: string;
  purpose: "access" | "drop";
  expires_at: string;
  confirmed_at: string | null;
  consent_requested: boolean;
  disclosure: string;
  home_zip: string;
  work_zip: string | null;
  source_id: string | null;
  created_at: string;
};
const zip = (value: string) => {
  if (!/^\d{5}$/.test(value))
    throw new RequestError("Enter a five-digit ZIP code.");
  return value;
};
export async function resolveMarket(
  db: DB,
  homeZip: string,
  workZip: string | null,
) {
  const [market] = await db.query<{ id: string }>(
    `select m.id from market_cells m join market_zips z on z.market_id=m.id where m.state in ('building','pilot','live') and (z.zip=$1 or z.zip=$2) order by case when z.zip=$1 then 0 else 1 end,m.slug limit 1`,
    [homeZip, workZip],
  );
  return market?.id || null;
}
export async function acquisitionSource(db: DB, sourceToken: string) {
  const [source] = await db.query<{
    id: string;
    name: string;
    market_id: string;
    partner_id: string | null;
    partner: string | null;
    market: string;
    state: string;
  }>(
    `select s.*,p.name partner,m.name market from acquisition_sources s join market_cells m on m.id=s.market_id left join acquisition_partners p on p.id=s.partner_id where s.token=$1 and s.state='active' and m.state in ('building','pilot','live') and (p.id is null or p.state='active')`,
    [sourceToken],
  );
  if (!source)
    throw new RequestError(
      "This Uptick invitation is not available right now.",
      404,
    );
  return source;
}
export async function requestMemberAccess(
  db: DB,
  input: {
    phone: string;
    homeZip?: string;
    workZip?: string;
    sourceToken?: string;
    referralToken?: string;
    consentRequested: boolean;
  },
) {
  const phone = normalizePhone(input.phone);
  await rateLimit(db, `member-access:${hash(phone)}`, 6, 3600);
  return db.transaction(async (tx) => {
    const source = input.sourceToken
      ? await acquisitionSource(tx, input.sourceToken)
      : null;
    const [customer] = await tx.query<{ id: string }>(
      "insert into customers(id,phone) values($1,$2) on conflict(phone) do update set phone=excluded.phone returning id",
      [id(), phone],
    );
    let [member] = await tx.query<Member>(
      "select * from uptick_members where customer_id=$1 for update",
      [customer.id],
    );
    if (!member && !input.homeZip)
      throw new RequestError("Enter your home ZIP to join Uptick.");
    const homeZip = zip(input.homeZip || member.home_zip),
      workZip =
        input.workZip === undefined
          ? member?.work_zip || null
          : input.workZip
            ? zip(input.workZip)
            : null;
    if (!member) {
      [member] = await tx.query<Member>(
        "insert into uptick_members(id,customer_id,home_zip,work_zip,market_id,source_id) values($1,$2,$3,$4,$5,$6) returning *",
        [
          id(),
          customer.id,
          homeZip,
          workZip,
          await resolveMarket(tx, homeZip, workZip),
          source?.id || null,
        ],
      );
      await demandEvent(tx, {
        kind: "membership_requested",
        memberId: member.id,
        marketId: member.market_id,
        sourceId: member.source_id,
        dedupKey: `requested:${member.id}`,
      });
    }
    const credential = token();
    const [access] = await tx.query<Access>(
      `insert into member_access(id,member_id,token_hash,token_encrypted,expires_at,consent_requested,disclosure,home_zip,work_zip,source_id) values($1,$2,$3,$4,now()+interval '30 minutes',$5,$6,$7,$8,$9) returning *`,
      [
        id(),
        member.id,
        hash(credential),
        encrypt(credential),
        input.consentRequested,
        MEMBERSHIP_DISCLOSURE,
        homeZip,
        workZip,
        source?.id || null,
      ],
    );
    // Referral credit must originate on this exact pre-verification access request.
    // Invalid/expired invitations never prevent someone joining Uptick normally.
    if (
      input.referralToken &&
      !member.verified_at &&
      /^[A-Za-z0-9_-]{43}$/.test(input.referralToken)
    ) {
      const [referral] = await tx.query<{ id: string }>(
        "select r.id from member_referrals r join market_cells k on k.id=r.market_id where r.public_token=$1 and r.expires_at>now() and r.member_id<>$2 and k.state in ('pilot','live')",
        [input.referralToken, member.id],
      );
      if (referral)
        await tx.query(
          "insert into access_referral_intents(access_id,member_id,referral_id) values($1,$2,$3)",
          [access.id, member.id, referral.id],
        );
    }
    return { member, access, credential };
  });
}
export async function memberAccess(
  db: DB,
  credential: string,
  confirmed = false,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(credential))
    throw new RequestError("This private Uptick link is not valid.", 404);
  const [access] = await db.query<Access>(
    "select * from member_access where token_hash=$1 and expires_at>now()",
    [hash(credential)],
  );
  if (!access || (confirmed && !access.confirmed_at))
    throw new RequestError("Open your private Uptick link to continue.", 401);
  const [member] = await db.query<Member>(
    "select * from uptick_members where id=$1",
    [access.member_id],
  );
  if (!member) throw new RequestError("This membership is unavailable.", 404);
  return { access, member };
}
export async function confirmMemberAccess(
  db: DB,
  credential: string,
  acceptMembership: boolean,
) {
  return db.transaction(async (tx) => {
    const initial = await memberAccess(tx, credential);
    await tx.query("select id from uptick_members where id=$1 for update", [
      initial.member.id,
    ]);
    const { access, member } = await memberAccess(tx, credential);
    if (access.confirmed_at) return member;
    await tx.query(
      "update member_access set confirmed_at=now(),expires_at=greatest(expires_at,now()+interval '30 days') where id=$1",
      [access.id],
    );
    if (!member.verified_at)
      await tx.query(
        "insert into member_first_verifications(member_id,access_id) values($1,$2) on conflict(member_id) do nothing",
        [member.id, access.id],
      );
    // A weekly message is not a new consent request. Reopening an old link cannot resubscribe.
    const subscribe =
      access.purpose === "access" &&
      access.consent_requested &&
      acceptMembership;
    const marketId =
      access.purpose === "access"
        ? await resolveMarket(tx, access.home_zip, access.work_zip)
        : member.market_id;
    await tx.query(
      `update uptick_members set verified_at=coalesce(verified_at,now()),home_zip=$2,work_zip=$3,market_id=$4,state=case when $5 then 'active' else state end,updated_at=now() where id=$1`,
      [
        member.id,
        access.purpose === "access" ? access.home_zip : member.home_zip,
        access.purpose === "access" ? access.work_zip : member.work_zip,
        marketId,
        subscribe,
      ],
    );
    if (
      access.purpose === "access" &&
      access.consent_requested &&
      (subscribe || member.state === "pending")
    )
      await recordMemberConsent(
        tx,
        member.id,
        subscribe,
        "private-membership-confirmation",
        access.disclosure,
      );
    await demandEvent(tx, {
      kind: subscribe ? "member_joined" : "member_access_confirmed",
      memberId: member.id,
      marketId,
      sourceId: member.source_id,
      dedupKey: subscribe ? `joined:${member.id}` : `access:${access.id}`,
    });
    return (
      await tx.query<Member>("select * from uptick_members where id=$1", [
        member.id,
      ])
    )[0];
  });
}
export async function recordMemberConsent(
  db: DB,
  memberId: string,
  accepted: boolean,
  sourceUi: string,
  disclosure = MEMBERSHIP_DISCLOSURE,
) {
  await db.query(
    "insert into member_consents(id,member_id,accepted,disclosure_version,disclosure,source_ui) values($1,$2,$3,$4,$5,$6)",
    [
      id(),
      memberId,
      accepted,
      MEMBERSHIP_DISCLOSURE_VERSION,
      disclosure,
      sourceUi,
    ],
  );
}
export async function memberPreferences(
  db: DB,
  credential: string,
  input: { homeZip: string; workZip: string; subscribed: boolean },
) {
  return db.transaction(async (tx) => {
    const { member } = await memberAccess(tx, credential, true);
    await tx.query("select id from uptick_members where id=$1 for update", [
      member.id,
    ]);
    const homeZip = zip(input.homeZip),
      workZip = input.workZip ? zip(input.workZip) : null;
    await tx.query(
      `update uptick_members set home_zip=$2,work_zip=$3,market_id=$4,state=$5,updated_at=now() where id=$1`,
      [
        member.id,
        homeZip,
        workZip,
        await resolveMarket(tx, homeZip, workZip),
        input.subscribed ? "active" : "paused",
      ],
    );
    await recordMemberConsent(
      tx,
      member.id,
      input.subscribed,
      "member-preferences",
    );
    await demandEvent(tx, {
      kind: "member_preferences_saved",
      memberId: member.id,
      detail: { subscribed: input.subscribed },
    });
  });
}
