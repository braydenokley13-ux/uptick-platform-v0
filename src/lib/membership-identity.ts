import type { DB } from "./db";
import { rateLimit } from "./domain";
import { appUrl, localMode } from "./config";
import { id, token, hash, encrypt, normalizePhone } from "./security";
import { RequestError } from "./http";
import { demandEvent } from "./demand-events";
import { uptickEnvironment } from "./environment";
import { createMemberSession, memberSession } from "./member-session";
import {
  MARKETING_SMS_DISCLOSURE,
  MEMBERSHIP_DISCLOSURE,
} from "./membership-copy";
import { tryAdmitMemberInTransaction } from "./pilot-operations";

export const MEMBERSHIP_DISCLOSURE_VERSION =
  "uptick-promotional-sms-2026-09-v2";
export const MEMBERSHIP_CONSENT_PURPOSE = "promotional_membership_sms";
export { MEMBERSHIP_DISCLOSURE } from "./membership-copy";

export type Member = {
  id: string;
  customer_id: string;
  home_zip: string;
  work_zip: string | null;
  market_id: string | null;
  source_id: string | null;
  state: "pending" | "active" | "paused";
  data_kind: "real" | "internal" | "demo" | "synthetic";
  age_confirmed_at: string | null;
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
  consumed_at: string | null;
  exchanged_session_id: string | null;
  consent_requested: boolean;
  age_attested: boolean;
  disclosure: string;
  home_zip: string;
  work_zip: string | null;
  source_id: string | null;
  created_at: string;
};

export type ConsentAction = "opt_in" | "declined" | "opt_out" | "stop";

const zip = (value: string) => {
  if (!/^\d{5}$/.test(value))
    throw new RequestError("Enter a five-digit ZIP code.");
  return value;
};

function enrollmentDataKind() {
  const environment = uptickEnvironment();
  if (environment === "development" && localMode()) return "internal" as const;
  if (environment === "staging") return "internal" as const;
  if (environment !== "production")
    throw new RequestError(
      "Membership enrollment is not available in this environment.",
      503,
    );
  let canonical = false;
  try {
    canonical = new URL(appUrl()).href === "https://pilot.upticklocal.com/";
  } catch {
    /* Invalid production origins keep real classification closed. */
  }
  const legalIdentity =
    process.env.LEGAL_APPROVED === "true" &&
    !!process.env.BUSINESS_LEGAL_NAME?.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.SUPPORT_EMAIL || "");
  if (
    !canonical ||
    process.env.PILOT_ENROLLMENT_ENABLED !== "true" ||
    !legalIdentity
  )
    throw new RequestError(
      "Real pilot enrollment is not open yet. Please check back soon.",
      503,
    );
  return "real" as const;
}

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
    ageAttested?: boolean;
  },
) {
  const phone = normalizePhone(input.phone);
  await rateLimit(db, `member-access:${hash(phone)}`, 6, 3600);
  const dataKind = enrollmentDataKind();
  // Existing local fixtures predate the adult field. Hosted/public enrollment
  // always supplies an explicit true value and cannot use this local fixture path.
  const ageAttested =
    input.ageAttested === true ||
    (localMode() && input.ageAttested === undefined);
  if (!ageAttested)
    throw new RequestError("Confirm that you are 18 or older to join Uptick.");
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
        `insert into uptick_members(id,customer_id,home_zip,work_zip,market_id,source_id,data_kind)
         values($1,$2,$3,$4,$5,$6,$7) returning *`,
        [
          id(),
          customer.id,
          homeZip,
          workZip,
          await resolveMarket(tx, homeZip, workZip),
          source?.id || null,
          dataKind,
        ],
      );
      await demandEvent(tx, {
        kind: "membership_requested",
        memberId: member.id,
        marketId: member.market_id,
        sourceId: member.source_id,
        detail: { dataKind },
        dedupKey: `requested:${member.id}`,
      });
    }
    const credential = token();
    const [access] = await tx.query<Access>(
      `insert into member_access(id,member_id,token_hash,token_encrypted,expires_at,consent_requested,age_attested,disclosure,home_zip,work_zip,source_id)
       values($1,$2,$3,$4,now()+interval '30 minutes',$5,$6,$7,$8,$9,$10) returning *`,
      [
        id(),
        member.id,
        hash(credential),
        encrypt(credential),
        input.consentRequested,
        ageAttested,
        MARKETING_SMS_DISCLOSURE,
        homeZip,
        workZip,
        source?.id || null,
      ],
    );
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

async function accessByCredential(db: DB, credential: string) {
  const [access] = await db.query<Access>(
    "select * from member_access where token_hash=$1 and expires_at>now()",
    [hash(credential)],
  );
  return access || null;
}

export async function memberAccess(
  db: DB,
  credential: string,
  confirmed = false,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(credential))
    throw new RequestError("This private Uptick link is not valid.", 404);
  let access: Access | null | undefined = await accessByCredential(
    db,
    credential,
  );
  let memberId: string | undefined = access?.member_id;
  if (!access) {
    const session = await memberSession(db, credential);
    memberId = session?.member_id;
    if (session?.source_access_id)
      [access] = await db.query<Access>(
        "select * from member_access where id=$1 and member_id=$2",
        [session.source_access_id, session.member_id],
      );
    if (session && !access)
      [access] = await db.query<Access>(
        "select * from member_access where member_id=$1 and confirmed_at is not null order by confirmed_at desc limit 1",
        [session.member_id],
      );
  }
  if (!access || !memberId || (confirmed && !access.confirmed_at))
    throw new RequestError("Open your private Uptick link to continue.", 401);
  const [member] = await db.query<Member>(
    "select * from uptick_members where id=$1",
    [memberId],
  );
  if (!member) throw new RequestError("This membership is unavailable.", 404);
  return { access, member };
}

async function confirmMemberAccessInTransaction(
  tx: DB,
  credential: string,
  acceptMarketing: boolean,
) {
  const access = await accessByCredential(tx, credential);
  if (!access || access.purpose !== "access")
    throw new RequestError("This private Uptick link is not valid.", 404);
  if (!access.age_attested)
    throw new RequestError("Confirm that you are 18 or older to join Uptick.");
  const [member] = await tx.query<Member>(
    "select * from uptick_members where id=$1 for update",
    [access.member_id],
  );
  if (!member) throw new RequestError("This membership is unavailable.", 404);
  if (!access.confirmed_at) {
    await tx.query("update member_access set confirmed_at=now() where id=$1", [
      access.id,
    ]);
    const firstVerification = !member.verified_at;
    if (firstVerification)
      await tx.query(
        "insert into member_first_verifications(member_id,access_id) values($1,$2) on conflict(member_id) do nothing",
        [member.id, access.id],
      );
    if (firstVerification) {
      const marketId = await resolveMarket(
        tx,
        access.home_zip,
        access.work_zip,
      );
      await tx.query(
        `update uptick_members set verified_at=now(),age_confirmed_at=now(),
         home_zip=$2,work_zip=$3,market_id=$4,state='active',updated_at=now()
         where id=$1`,
        [member.id, access.home_zip, access.work_zip, marketId],
      );
      const optedIn = access.consent_requested && acceptMarketing;
      await recordMemberConsent(
        tx,
        member.id,
        optedIn,
        "private-membership-confirmation",
        access.disclosure,
        optedIn ? "opt_in" : "declined",
      );
      const admission = await tryAdmitMemberInTransaction(tx, member.id);
      await demandEvent(tx, {
        kind: "member_joined",
        memberId: member.id,
        marketId,
        sourceId: member.source_id,
        detail: { promotionalSms: optedIn, admission: admission.state },
        dedupKey: `joined:${member.id}`,
      });
    } else {
      await tx.query(
        "update uptick_members set age_confirmed_at=coalesce(age_confirmed_at,now()) where id=$1",
        [member.id],
      );
      await demandEvent(tx, {
        kind: "member_access_confirmed",
        memberId: member.id,
        marketId: member.market_id,
        sourceId: member.source_id,
        dedupKey: `access:${access.id}`,
      });
    }
  }
  return (
    await tx.query<Member>("select * from uptick_members where id=$1", [
      member.id,
    ])
  )[0];
}

export async function confirmMemberAccess(
  db: DB,
  credential: string,
  acceptMarketing: boolean,
) {
  return db.transaction((tx) =>
    confirmMemberAccessInTransaction(tx, credential, acceptMarketing),
  );
}

export async function exchangeMemberAccess(
  db: DB,
  credential: string,
  acceptMarketing: boolean,
) {
  return db.transaction(async (tx) => {
    const access = await accessByCredential(tx, credential);
    if (!access || access.purpose !== "access")
      throw new RequestError("This private Uptick link is not valid.", 404);
    await tx.query("select id from member_access where id=$1 for update", [
      access.id,
    ]);
    const current = await accessByCredential(tx, credential);
    if (!current || current.consumed_at || current.exchanged_session_id)
      throw new RequestError(
        "This access link was already used. Open Your Uptick or use a recovery code.",
        409,
      );
    const member = await confirmMemberAccessInTransaction(
      tx,
      credential,
      acceptMarketing,
    );
    const created = await createMemberSession(tx, member.id, current.id);
    await tx.query(
      "update member_access set consumed_at=now(),exchanged_session_id=$2 where id=$1",
      [current.id, created.session.id],
    );
    return { member, ...created };
  });
}

export async function recordMemberConsent(
  db: DB,
  memberId: string,
  accepted: boolean,
  sourceUi: string,
  disclosure = MEMBERSHIP_DISCLOSURE,
  action: ConsentAction = accepted ? "opt_in" : "opt_out",
) {
  await db.query(
    `insert into member_consents(id,member_id,accepted,disclosure_version,disclosure,source_ui,consent_purpose,consent_action)
     values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id(),
      memberId,
      accepted,
      MEMBERSHIP_DISCLOSURE_VERSION,
      disclosure,
      sourceUi,
      MEMBERSHIP_CONSENT_PURPOSE,
      action,
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
      `update uptick_members set home_zip=$2,work_zip=$3,market_id=$4,updated_at=now()
       where id=$1`,
      [member.id, homeZip, workZip, await resolveMarket(tx, homeZip, workZip)],
    );
    await recordMemberConsent(
      tx,
      member.id,
      input.subscribed,
      "member-preferences",
      MARKETING_SMS_DISCLOSURE,
      input.subscribed ? "opt_in" : "opt_out",
    );
    await demandEvent(tx, {
      kind: "member_preferences_saved",
      memberId: member.id,
      detail: { promotionalSms: input.subscribed },
    });
  });
}
