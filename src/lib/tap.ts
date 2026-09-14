import type { DB } from "./db";
import {
  audit,
  authorize,
  confirmPossession,
  getPass,
  passState,
  type Actor,
  type Claim,
} from "./domain";
import { RequestError } from "./http";
import { id, token } from "./security";
import { NFC_PROFILE, nfcKey, verifyNtag424, type NfcProof } from "./nfc";
import { supplyUsage } from "./network";

export type TapPoint = {
  id: string;
  organization_id: string;
  location_id: string;
  name: string;
  exposure: "staff" | "public";
  state: "active" | "revoked";
};
export type TapCredential = {
  id: string;
  point_id: string;
  public_token: string;
  credential_type: "qr" | "secure_nfc";
  state: "active" | "revoked";
  version: number;
  uid: string | null;
  profile: string | null;
  meta_key_ref: string | null;
  file_key_ref: string | null;
  last_counter: number;
};
type Supply = {
  id: string;
  organization_id: string;
  location_id: string;
  offer_id: string;
  offer_version: number;
  state: string;
  verification_mode: "staff_tap" | "public_tap" | "self_confirm";
  self_confirm_approved: boolean;
  inventory_policy: string;
  quantity: number | null;
  starts_at: string;
  expires_at: string;
  reserved_until: string | null;
};
export type TapEvidence = {
  method: "qr" | "secure_nfc" | "self_confirm" | "operator_override";
  verification_level: number;
  verification_policy: string;
  staff_gated: boolean;
  transaction_verified: boolean;
  created_at: string;
};
type RecoveryGrant = {
  id: string;
  incident_id: string;
  original_claim_id: string;
  remedy_type: "same_counter" | "replacement_supply";
  target_organization_id: string;
  target_location_id: string;
  replacement_supply_id: string | null;
  member_snapshot: {
    merchant?: string;
    address?: string;
    exact_item?: string;
    size_label?: string;
    usable_hours?: string;
    instructions?: string;
  };
  expires_at: string;
  state: "issued" | "redeemed";
  redeemed_at: string | null;
};
type RecoveryEvidence = {
  method: "qr" | "secure_nfc" | "operator_override";
  verification_level: number;
  staff_gated: boolean;
  transaction_verified: boolean;
  created_at: string;
};

function validatePointPolicy(
  point: TapPoint | undefined,
  credential: Pick<TapCredential, "state"> | undefined,
  organizationId: string,
  locationId: string,
  policy: string,
) {
  if (
    !point ||
    point.state !== "active" ||
    !credential ||
    credential.state !== "active"
  )
    throw new RequestError(
      "This Uptick Tap was replaced or revoked. Ask the cashier for the current sign.",
    );
  if (
    point.organization_id !== organizationId ||
    point.location_id !== locationId
  )
    throw new RequestError(
      "This pass belongs to a different store. Open your pass for its address.",
    );
  if (policy === "staff_tap" && point.exposure !== "staff")
    throw new RequestError(
      "Ask the cashier to present the staff Uptick Tap after checking the offer.",
    );
}
function requireFreshCounter(counter: number, previous: number) {
  if (counter <= previous)
    throw new RequestError(
      "This secure Tap has already been used. Tap the sign again for a fresh credential.",
    );
}

export async function createRedemptionPoint(
  db: DB,
  actor: Actor,
  input: {
    organizationId: string;
    locationId: string;
    name: string;
    exposure: "staff" | "public";
  },
) {
  authorize(actor, input.organizationId, true);
  if (
    !input.name.trim() ||
    input.name.length > 100 ||
    !["staff", "public"].includes(input.exposure)
  )
    throw new RequestError(
      "Name the counter and choose staff or public access.",
    );
  return db.transaction(async (tx) => {
    const [location] = await tx.query<{ id: string }>(
      "select id from locations where id=$1 and organization_id=$2",
      [input.locationId, input.organizationId],
    );
    if (!location)
      throw new RequestError("Choose a location belonging to this merchant.");
    const pointId = id();
    const [point] = await tx.query<TapPoint>(
      "insert into redemption_points(id,organization_id,location_id,name,exposure,created_by) values($1,$2,$3,$4,$5,$6) returning *",
      [
        pointId,
        input.organizationId,
        input.locationId,
        input.name.trim(),
        input.exposure,
        actor.id,
      ],
    );
    const [credential] = await tx.query<TapCredential>(
      "insert into redemption_credentials(id,point_id,public_token,credential_type,version,created_by) values($1,$2,$3,'qr',1,$4) returning *",
      [id(), pointId, token(), actor.id],
    );
    await audit(
      tx,
      actor.id,
      input.organizationId,
      "tap.point_created",
      pointId,
      { locationId: input.locationId, exposure: input.exposure },
    );
    return { point, credential };
  });
}

export async function rotateTapCredential(
  db: DB,
  actor: Actor,
  pointId: string,
  input:
    | { type: "qr" }
    | {
        type: "secure_nfc";
        uid: string;
        metaKeyRef: string;
        fileKeyRef: string;
      },
) {
  return db.transaction(async (tx) => {
    const [point] = await tx.query<TapPoint>(
      "select * from redemption_points where id=$1 for update",
      [pointId],
    );
    if (!point) throw new RequestError("Redemption point not found.", 404);
    authorize(actor, point.organization_id, true);
    if (point.state !== "active")
      throw new RequestError(
        "Create a replacement for this revoked redemption point.",
      );
    if (input.type !== "qr" && input.type !== "secure_nfc")
      throw new RequestError("Choose QR or secure NFC.");
    if (input.type === "secure_nfc") {
      if (!/^[0-9a-fA-F]{14}$/.test(input.uid))
        throw new RequestError(
          "Enter the tag’s seven-byte UID as 14 hexadecimal characters.",
        );
      nfcKey(input.metaKeyRef);
      nfcKey(input.fileKeyRef);
    }
    const [previous] = await tx.query<TapCredential>(
      "select * from redemption_credentials where point_id=$1 and credential_type=$2 order by version desc limit 1 for update",
      [pointId, input.type],
    );
    if (previous)
      await tx.query(
        "update redemption_credentials set state='revoked',revoked_at=coalesce(revoked_at,now()) where id=$1",
        [previous.id],
      );
    // Changing the URL must not make an old authenticated read usable again.
    // A real replacement tag has a different UID; the same tag keeps its high-water mark.
    const [history] =
      input.type === "secure_nfc"
        ? await tx.query<{ last_counter: number }>(
            "select coalesce(max(last_counter),-1)::integer last_counter from redemption_credentials where uid=$1",
            [input.uid.toUpperCase()],
          )
        : [{ last_counter: -1 }];
    const [credential] = await tx.query<TapCredential>(
      "insert into redemption_credentials(id,point_id,public_token,credential_type,version,replaces_id,uid,profile,meta_key_ref,file_key_ref,created_by,last_counter) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *",
      [
        id(),
        pointId,
        token(),
        input.type,
        (previous?.version || 0) + 1,
        previous?.id || null,
        input.type === "secure_nfc" ? input.uid.toUpperCase() : null,
        input.type === "secure_nfc" ? NFC_PROFILE : null,
        input.type === "secure_nfc" ? input.metaKeyRef : null,
        input.type === "secure_nfc" ? input.fileKeyRef : null,
        actor.id,
        history.last_counter,
      ],
    );
    await audit(
      tx,
      actor.id,
      point.organization_id,
      "tap.credential_rotated",
      credential.id,
      {
        pointId,
        type: input.type,
        version: credential.version,
        replacesId: previous?.id || null,
      },
    );
    return credential;
  });
}

export async function revokeRedemptionPoint(
  db: DB,
  actor: Actor,
  pointId: string,
) {
  return db.transaction(async (tx) => {
    const [point] = await tx.query<TapPoint>(
      "select * from redemption_points where id=$1 for update",
      [pointId],
    );
    if (!point) throw new RequestError("Redemption point not found.", 404);
    authorize(actor, point.organization_id, true);
    await tx.query(
      "update redemption_points set state='revoked',revoked_at=coalesce(revoked_at,now()) where id=$1",
      [pointId],
    );
    await tx.query(
      "update redemption_credentials set state='revoked',revoked_at=coalesce(revoked_at,now()) where point_id=$1",
      [pointId],
    );
    await audit(
      tx,
      actor.id,
      point.organization_id,
      "tap.point_revoked",
      pointId,
    );
  });
}

export async function tapLanding(db: DB, publicToken: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(publicToken))
    throw new RequestError("This Uptick Tap is unavailable.", 404);
  const [point] = await db.query<
    TapPoint & {
      merchant: string;
      address: string;
      credential_type: string;
      is_demo: boolean;
    }
  >(
    "select p.*,g.name merchant,l.address,c.credential_type,g.is_demo from redemption_credentials c join redemption_points p on p.id=c.point_id join organizations g on g.id=p.organization_id join locations l on l.id=p.location_id where c.public_token=$1 and c.state='active' and p.state='active'",
    [publicToken],
  );
  if (!point)
    throw new RequestError(
      "This Uptick Tap is unavailable. Ask the cashier for its replacement.",
      404,
    );
  return point;
}

// A landing-page read restores the saved result without redeeming, confirming
// possession, recording a visit, or consuming an NFC authentication counter.
export async function tapPassView(
  db: DB,
  privateToken: string,
  point: TapPoint,
  at = new Date(),
) {
  const claim = await getPass(db, privateToken);
  const [offer] = await db.query<{ location_id: string }>(
    "select location_id from offers where id=$1",
    [claim.offer_id],
  );
  const [supply] = await db.query<Supply>(
    "select s.*,mc.reserved_until from member_claims mc join network_drop_supplies s on s.id=mc.supply_id where mc.claim_id=$1",
    [claim.id],
  );
  const [recovery] = await db.query<RecoveryGrant>(
    `select r.* from recovery_grants r
     where r.original_claim_id=$1 order by r.issued_at desc limit 1`,
    [claim.id],
  );
  const recoveryAvailable =
    recovery?.state === "issued" && new Date(recovery.expires_at) > at;
  const recoveryDestination =
    recoveryAvailable || recovery?.state === "redeemed";
  const matches = recoveryDestination
    ? recovery.target_organization_id === point.organization_id &&
      recovery.target_location_id === point.location_id
    : claim.organization_id === point.organization_id &&
      offer?.location_id === point.location_id;
  let state = passState(claim, at);
  if (
    state === "active" &&
    supply?.reserved_until &&
    new Date(supply.reserved_until) <= at
  )
    state = "expired";
  let blockedReason: string | null = null;
  if (state === "active" && supply) {
    if (!["approved", "paused", "ended"].includes(supply.state))
      blockedReason = "This Drop is not available for redemption right now.";
    else if (
      supply.verification_mode === "staff_tap" &&
      point.exposure !== "staff"
    )
      blockedReason =
        "Ask the cashier to present the staff Uptick Tap after checking the offer.";
    else if (supply.inventory_policy !== "unlimited") {
      const usage = await supplyUsage(db, supply.id, at);
      if (usage.quantity !== null && usage.redeemed >= usage.quantity)
        blockedReason = "This Drop’s available quantity has been used.";
    }
  }
  const [evidence] =
    state === "redeemed"
      ? await db.query<TapEvidence>(
          "select * from redemption_evidence where claim_id=$1",
          [claim.id],
        )
      : [];
  const [recoveryEvidence] = recovery
    ? await db.query<RecoveryEvidence>(
        "select * from recovery_redemptions where recovery_grant_id=$1",
        [recovery.id],
      )
    : [];
  const recoveryState = recovery
    ? recovery.state === "redeemed"
      ? "redeemed"
      : recoveryAvailable
        ? "available"
        : "expired"
    : null;
  return {
    claim,
    matches,
    state: recoveryAvailable
      ? "recovery_available"
      : recovery?.state === "issued"
        ? "recovery_expired"
        : state,
    blockedReason: recovery ? null : blockedReason,
    evidence: evidence || null,
    recovery: recovery || null,
    recoveryState,
    recoveryEvidence: recoveryEvidence || null,
  };
}

async function lockedClaim(db: DB, privateToken: string) {
  const initial = await getPass(db, privateToken);
  const [offer] = await db.query<{ location_id: string; state: string }>(
    "select location_id,state from offers where id=$1 for update",
    [initial.offer_id],
  );
  const [supply] = await db.query<Supply>(
    "select s.*,mc.reserved_until from member_claims mc join network_drop_supplies s on s.id=mc.supply_id where mc.claim_id=$1 for update of s",
    [initial.id],
  );
  const claim = await getPass(db, privateToken);
  const [recovery] = await db.query<RecoveryGrant>(
    `select * from recovery_grants where original_claim_id=$1
     order by issued_at desc limit 1 for update`,
    [claim.id],
  );
  return { claim, offer, supply, recovery };
}

async function finishRecovery(
  db: DB,
  context: Awaited<ReturnType<typeof lockedClaim>>,
  verification: {
    pointId?: string;
    credentialId?: string;
    method: "qr" | "secure_nfc" | "operator_override";
    level: number;
    counter?: number;
    actor?: string;
    reason?: string;
  },
) {
  const { claim, recovery } = context;
  if (!recovery)
    throw new RequestError("This pass does not have an issued recovery.");
  const [existing] = await db.query<RecoveryEvidence>(
    "select * from recovery_redemptions where recovery_grant_id=$1",
    [recovery.id],
  );
  if (recovery.state === "redeemed")
    return { claim, recovery, evidence: existing || null, repeated: true };
  if (!["active", "redeemed"].includes(claim.state))
    throw new RequestError(
      "This original pass can no longer use its recovery.",
    );
  if (new Date(recovery.expires_at) <= new Date())
    throw new RequestError(
      "This recovery has expired. Contact Uptick support.",
    );
  const [evidence] = await db.query<RecoveryEvidence>(
    `insert into recovery_redemptions(
      id,recovery_grant_id,original_claim_id,point_id,credential_id,method,
      verification_level,staff_gated,nfc_counter,actor,reason
     ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [
      id(),
      recovery.id,
      claim.id,
      verification.pointId || null,
      verification.credentialId || null,
      verification.method,
      verification.level,
      verification.method !== "operator_override",
      verification.counter ?? null,
      verification.actor || "member",
      verification.reason || null,
    ],
  );
  const [updated] = await db.query<RecoveryGrant>(
    "update recovery_grants set state='redeemed',redeemed_at=now() where id=$1 and state='issued' returning *",
    [recovery.id],
  );
  const [closedClaim] =
    claim.state === "active"
      ? await db.query<Claim>(
          "update claims set state='invalidated' where id=$1 and state='active' returning *",
          [claim.id],
        )
      : [claim];
  await db.query(
    "update fulfillment_incidents set state='resolved',resolution='Recovery redeemed at the promised destination.' where id=$1",
    [recovery.incident_id],
  );
  await audit(
    db,
    verification.actor || "member",
    recovery.target_organization_id,
    "pilot.recovery_redeemed",
    recovery.id,
    {
      originalClaimId: claim.id,
      method: verification.method,
      pointId: verification.pointId || null,
      transactionVerified: false,
    },
  );
  await db.query(
    `insert into demand_events(
      id,member_id,market_id,organization_id,location_id,source_id,supply_id,
      allocation_id,claim_id,kind,evidence_class,detail,dedup_key
     ) select $1,g.member_id,g.market_id,$2,$3,m.source_id,
      coalesce(r.replacement_supply_id,g.supply_id),g.allocation_id,$4,
      'recovery_redeemed','observed',$5,$6
     from recovery_grants r join fulfillment_grants g on g.id=r.original_grant_id
     join uptick_members m on m.id=g.member_id where r.id=$7
     on conflict(dedup_key) do nothing`,
    [
      id(),
      recovery.target_organization_id,
      recovery.target_location_id,
      claim.id,
      {
        method: verification.method,
        verificationLevel: verification.level,
        originalHistoryPreserved: true,
        originalDigitalRedemptionPreserved: claim.state === "redeemed",
        countsAsWeeklyBenefit: false,
        countsAsPaidPlacement: false,
      },
      `recovery-redemption:${recovery.id}`,
      recovery.id,
    ],
  );
  return { claim: closedClaim, recovery: updated, evidence, repeated: false };
}

async function finishRedemption(
  db: DB,
  context: Awaited<ReturnType<typeof lockedClaim>>,
  verification: {
    pointId?: string;
    credentialId?: string;
    method: TapEvidence["method"];
    level: number;
    counter?: number;
    actor?: string;
    reason?: string;
  },
) {
  const { claim, supply, offer, recovery } = context;
  const [existing] = await db.query<TapEvidence>(
    "select * from redemption_evidence where claim_id=$1",
    [claim.id],
  );
  if (claim.state === "redeemed")
    return { claim, evidence: existing || null, repeated: true };
  if (recovery)
    throw new RequestError(
      "This pass now carries a backed recovery and cannot redeem the original item.",
    );
  if (passState(claim) !== "active")
    throw new RequestError(
      "This pass cannot be redeemed. Check its status and dates.",
    );
  if (supply) {
    if (
      supply.organization_id !== claim.organization_id ||
      supply.offer_id !== claim.offer_id ||
      supply.offer_version !== claim.offer_version ||
      supply.location_id !== offer.location_id
    )
      throw new RequestError("This pass does not match its Drop commitment.");
    // Pausing supply stops new acquisition; it does not break an issued promise.
    if (!["approved", "paused", "ended"].includes(supply.state))
      throw new RequestError(
        "This Drop is not available for redemption right now.",
      );
    if (supply.reserved_until && new Date(supply.reserved_until) <= new Date())
      throw new RequestError(
        "Your reservation has expired. Check Uptick for another available Drop.",
      );
    if (supply.inventory_policy !== "unlimited") {
      const [count] = await db.query<{ n: number }>(
        "select count(*)::int n from member_claims mc join claims c on c.id=mc.claim_id where mc.supply_id=$1 and c.state='redeemed'",
        [supply.id],
      );
      const [adjustments] = await db.query<{ delta: number }>(
        "select coalesce(sum(delta),0)::int delta from supply_adjustments where supply_id=$1",
        [supply.id],
      );
      if (count.n >= (supply.quantity || 0) + adjustments.delta)
        throw new RequestError("This Drop’s remaining quantity has been used.");
    }
  }
  if (!supply && claim.snapshot.limit_mode === "redemption") {
    const [count] = await db.query<{ n: number }>(
      "select count(*)::int n from claims where offer_id=$1 and state='redeemed'",
      [claim.offer_id],
    );
    if (count.n >= (claim.snapshot.quantity || 0))
      throw new RequestError("This offer’s redemption limit has been reached.");
  }
  await confirmPossession(db, claim);
  const [updated] = await db.query<Claim>(
    "update claims set state='redeemed',redeemed_at=now() where id=$1 and state='active' returning *",
    [claim.id],
  );
  await db.query(
    "insert into redemptions(id,claim_id,organization_id) values($1,$2,$3)",
    [id(), claim.id, claim.organization_id],
  );
  const policy = supply?.verification_mode || "legacy_staff_tap";
  const [evidence] = await db.query<TapEvidence>(
    "insert into redemption_evidence(id,claim_id,organization_id,point_id,credential_id,method,verification_level,verification_policy,staff_gated,nfc_counter,actor,reason) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *",
    [
      id(),
      claim.id,
      claim.organization_id,
      verification.pointId || null,
      verification.credentialId || null,
      verification.method,
      verification.level,
      policy,
      ["staff_tap", "legacy_staff_tap"].includes(policy) &&
        Boolean(verification.pointId),
      verification.counter ?? null,
      verification.actor || "member",
      verification.reason || null,
    ],
  );
  await audit(
    db,
    verification.actor || "member",
    claim.organization_id,
    "redemption.tap_completed",
    claim.id,
    {
      method: verification.method,
      verificationLevel: verification.level,
      pointId: verification.pointId || null,
      policy,
      transactionVerified: false,
    },
  );
  if (supply)
    await db.query(
      "insert into demand_events(id,member_id,market_id,organization_id,location_id,source_id,supply_id,allocation_id,claim_id,kind,evidence_class,detail,dedup_key) select $1,mc.member_id,s.market_id,mc.organization_id,s.location_id,m.source_id,mc.supply_id,mc.allocation_id,mc.claim_id,'redemption_completed','observed',$2,$3 from member_claims mc join network_drop_supplies s on s.id=mc.supply_id join uptick_members m on m.id=mc.member_id where mc.claim_id=$4 on conflict(dedup_key) do nothing",
      [
        id(),
        {
          method: verification.method,
          verificationLevel: verification.level,
          staffGated: evidence.staff_gated,
          transactionVerified: false,
          pointId: verification.pointId || null,
        },
        `redemption:${claim.id}`,
        claim.id,
      ],
    );
  await db.query(
    `update fulfillment_grants set state='redeemed',
      claimed_at=coalesce(claimed_at,now()),redeemed_at=now()
     where id=(select grant_id from member_claims where claim_id=$1)
      and state in ('issued','claimed')`,
    [claim.id],
  );
  return { claim: updated, evidence, repeated: false };
}

export async function redeemAtPoint(
  db: DB,
  privateToken: string,
  input: { pointToken?: string; nfc?: NfcProof; selfConfirm?: boolean },
) {
  return db.transaction(async (tx) => {
    const context = await lockedClaim(tx, privateToken);
    const { claim, supply, offer, recovery } = context;
    const recoveryAvailable =
      recovery?.state === "issued" &&
      new Date(recovery.expires_at) > new Date();
    const recoveryPath = recoveryAvailable || recovery?.state === "redeemed";
    if (input.selfConfirm) {
      if (recovery)
        throw new RequestError(
          "Use the staffed Uptick Tap for this backed recovery.",
        );
      if (
        !supply ||
        supply.verification_mode !== "self_confirm" ||
        !supply.self_confirm_approved
      )
        throw new RequestError(
          "This pass requires the Uptick Tap at the store.",
        );
      return finishRedemption(tx, context, {
        method: "self_confirm",
        level: 0,
      });
    }
    if (!input.pointToken || !/^[A-Za-z0-9_-]{43}$/.test(input.pointToken))
      throw new RequestError(
        "Tap the Uptick sign or scan its QR at the store.",
      );
    // Point then credential is the same order used by revocation and rotation.
    const [identity] = await tx.query<{ point_id: string }>(
      "select point_id from redemption_credentials where public_token=$1",
      [input.pointToken],
    );
    if (!identity)
      throw new RequestError("This Uptick Tap is unavailable.", 404);
    const [point] = await tx.query<TapPoint>(
      "select * from redemption_points where id=$1 for update",
      [identity.point_id],
    );
    const [credential] = await tx.query<TapCredential>(
      "select * from redemption_credentials where public_token=$1 for update",
      [input.pointToken],
    );
    const policy = recoveryPath
      ? "staff_tap"
      : supply?.verification_mode || "staff_tap";
    validatePointPolicy(
      point,
      credential,
      recoveryPath ? recovery!.target_organization_id : claim.organization_id,
      recoveryPath ? recovery!.target_location_id : offer.location_id,
      policy,
    );
    // An already completed pass returns its original evidence; it cannot consume a second counter.
    if (recovery?.state === "redeemed")
      return finishRecovery(tx, context, {
        method: credential.credential_type,
        level: credential.credential_type === "secure_nfc" ? 2 : 1,
      });
    if (claim.state === "redeemed" && !recoveryPath)
      return finishRedemption(tx, context, {
        method: credential.credential_type,
        level: credential.credential_type === "secure_nfc" ? 2 : 1,
      });
    let counter: number | undefined;
    if (credential.credential_type === "secure_nfc") {
      if (!input.nfc)
        throw new RequestError(
          "Tap the secure NFC sign again, or scan the separate QR fallback.",
        );
      const verified = verifyNtag424(input.nfc, {
        uid: credential.uid!,
        metaKey: nfcKey(credential.meta_key_ref!),
        fileKey: nfcKey(credential.file_key_ref!),
        profile: credential.profile!,
      });
      counter = verified.counter;
      requireFreshCounter(counter, credential.last_counter);
    } else if (input.nfc)
      throw new RequestError(
        "A QR fallback cannot be represented as secure NFC.",
      );
    const result = recoveryAvailable
      ? await finishRecovery(tx, context, {
          method: credential.credential_type,
          level: credential.credential_type === "secure_nfc" ? 2 : 1,
          pointId: point.id,
          credentialId: credential.id,
          counter,
        })
      : await finishRedemption(tx, context, {
          method: credential.credential_type,
          level: credential.credential_type === "secure_nfc" ? 2 : 1,
          pointId: point.id,
          credentialId: credential.id,
          counter,
        });
    await tx.query(
      "update redemption_credentials set last_validated_at=now(),last_counter=case when $2::integer is null then last_counter else $2 end where id=$1",
      [credential.id, counter ?? null],
    );
    return result;
  });
}

export async function operatorOverride(
  db: DB,
  actor: Actor,
  privateToken: string,
  reason: string,
) {
  if (!reason.trim() || reason.trim().length < 12 || reason.length > 1000)
    throw new RequestError("Explain the exception in at least 12 characters.");
  return db.transaction(async (tx) => {
    const context = await lockedClaim(tx, privateToken);
    const recoveryAvailable =
      context.recovery?.state === "issued" &&
      new Date(context.recovery.expires_at) > new Date();
    const recoveryPath =
      recoveryAvailable || context.recovery?.state === "redeemed";
    authorize(
      actor,
      recoveryPath
        ? context.recovery!.target_organization_id
        : context.claim.organization_id,
      true,
    );
    const verification = {
      method: "operator_override",
      level: 0,
      actor: actor.id,
      reason: reason.trim(),
    } as const;
    return recoveryPath
      ? finishRecovery(tx, context, verification)
      : finishRedemption(tx, context, verification);
  });
}

export async function simulateTap(
  db: DB,
  actor: Actor,
  pointId: string,
  scenario:
    "qr" | "secure_nfc_vector" | "wrong_location" | "replay" | "revoked",
) {
  const [point] = await db.query<TapPoint>(
    "select * from redemption_points where id=$1",
    [pointId],
  );
  if (!point) throw new RequestError("Redemption point not found.", 404);
  authorize(actor, point.organization_id, true);
  if (
    ![
      "qr",
      "secure_nfc_vector",
      "wrong_location",
      "replay",
      "revoked",
    ].includes(scenario)
  )
    throw new RequestError("Choose a supported rehearsal.");
  let detail: Record<string, unknown> = {
    simulation: true,
    hardwareTested: false,
    productionMetricsChanged: false,
  };
  let outcome = "simulated_success";
  try {
    if (scenario === "secure_nfc_vector" || scenario === "replay") {
      const verified = verifyNtag424(
        {
          encryptedPicc: "EF963FF7828658A599F3041510671E88",
          mac: "94EED9EE65337086",
        },
        {
          uid: "04DE5F1EACC040",
          metaKey: Buffer.alloc(16),
          fileKey: Buffer.alloc(16),
          profile: NFC_PROFILE,
        },
      );
      detail = {
        ...detail,
        reference: "NXP AN12196 rev2.0 table4",
        counter: verified.counter,
      };
      if (scenario === "replay")
        requireFreshCounter(verified.counter, verified.counter);
    } else {
      validatePointPolicy(
        scenario === "revoked" ? { ...point, state: "revoked" } : point,
        { state: "active" },
        point.organization_id,
        scenario === "wrong_location"
          ? "isolated-other-location"
          : point.location_id,
        point.exposure === "staff" ? "staff_tap" : "public_tap",
      );
    }
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    outcome = "simulated_rejection";
    detail.validationMessage = error.message;
  }
  const [event] = await db.query(
    "insert into tap_test_events(id,actor,point_id,scenario,outcome,detail) values($1,$2,$3,$4,$5,$6) returning *",
    [id(), actor.id, point.id, scenario, outcome, detail],
  );
  return event;
}
