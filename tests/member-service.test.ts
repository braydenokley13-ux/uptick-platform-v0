import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import { memberInbound } from "../src/lib/member-messaging";
import {
  memberAccess,
  requestMemberAccess,
} from "../src/lib/membership-identity";
import {
  memberServiceStatus,
  operationalPilotAudience,
  recordMemberServiceEvent,
} from "../src/lib/member-service";
import {
  createMemberSession,
  memberSession,
  recoverMemberSession,
  replaceMemberRecoveryCodes,
} from "../src/lib/member-session";
import { pilotScorecard } from "../src/lib/pilot-operations";
import { releaseWeeklyBenefits } from "../src/lib/pilot-promise";
import { encrypt, hash, token } from "../src/lib/security";
import { seedSyntheticPilot } from "../scripts/verify-postgres-pilot";

function localEnvironment() {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMS_TRANSPORT = "development";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.PILOT_ENROLLMENT_ENABLED;
}

async function withDatabase(run: (db: DB) => Promise<void>) {
  localEnvironment();
  const db = await memoryDb();
  try {
    await run(db);
  } finally {
    await db.close?.();
  }
}

function releaseInput(
  fixture: Awaited<ReturnType<typeof seedSyntheticPilot>>,
  memberIds: string[],
  requestKey: string,
) {
  return {
    runId: fixture.runId,
    marketId: fixture.marketId,
    weekKey: fixture.weekKey,
    dataKind: "synthetic" as const,
    requestKey,
    assignments: memberIds.map((memberId) => ({
      memberId,
      supplyId: fixture.supplyId,
    })),
  };
}

async function record(
  db: DB,
  actor: Actor | { memberId: string },
  memberId: string,
  kind:
    | "withdrawn"
    | "suspended"
    | "deletion_pending"
    | "inaccessible"
    | "geography_changed"
    | "resumed",
  requestKey: string,
) {
  return recordMemberServiceEvent(db, actor, {
    memberId,
    kind,
    reason: `Verified test reason for ${kind}.`,
    requestKey,
  });
}

test("withdrawal excludes one member from release while preserving the fixed denominator", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 2, "withdraw-one");
    const withdrawn = fixture.members[0];
    const included = fixture.members[1];
    const eventId = await record(
      db,
      { memberId: withdrawn.id },
      withdrawn.id,
      "withdrawn",
      "withdraw-one-event",
    );

    const audience = await operationalPilotAudience(db, fixture.runId);
    assert.equal(audience.admitted, 2);
    assert.deepEqual(
      audience.included.map((member) => member.member_id),
      [included.id],
    );
    assert.deepEqual(
      audience.excluded.map((member) => member.member_id),
      [withdrawn.id],
    );

    const published = await releaseWeeklyBenefits(
      db,
      fixture.actor,
      releaseInput(fixture, [included.id], "withdraw-one-release"),
    );
    assert.equal(published.release.member_count, 1);
    assert.deepEqual(
      published.grants.map((grant) => grant.member_id),
      [included.id],
    );
    assert.deepEqual(
      await db.query(
        "select member_id,service_event_id from weekly_release_exclusions where release_id=$1",
        [published.release.id],
      ),
      [{ member_id: withdrawn.id, service_event_id: eventId }],
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from pilot_admissions where run_id=$1",
          [fixture.runId],
        )
      )[0].count,
      2,
    );
    assert.equal(
      (await pilotScorecard(db, fixture.actor, fixture.runId)).denominator,
      2,
    );
  });
});

test("a fully withdrawn cohort records a zero-member release and every exclusion", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 1, "withdraw-all");
    const member = fixture.members[0];
    const eventId = await record(
      db,
      { memberId: member.id },
      member.id,
      "withdrawn",
      "withdraw-all-event",
    );

    const published = await releaseWeeklyBenefits(
      db,
      fixture.actor,
      releaseInput(fixture, [], "withdraw-all-release"),
    );
    assert.equal(published.release.member_count, 0);
    assert.equal(published.grants.length, 0);
    assert.deepEqual(
      await db.query(
        "select member_id,service_event_id from weekly_release_exclusions where release_id=$1",
        [published.release.id],
      ),
      [{ member_id: member.id, service_event_id: eventId }],
    );
    assert.equal(
      (await pilotScorecard(db, fixture.actor, fixture.runId)).denominator,
      1,
    );
  });
});

test("SMS STOP remains separate from participation and does not exclude the member", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 1, "stop-included");
    const member = fixture.members[0];
    const [customer] = await db.query<{ phone: string }>(
      "select phone from customers where id=$1",
      [member.customerId],
    );
    const serviceSid = `MG${"a".repeat(32)}`;
    await db.query(
      "insert into member_senders(id,service_sid,phone,approved) values('stop-sender',$1,'+12025550199',true)",
      [serviceSid],
    );

    await memberInbound(db, {
      MessageSid: `SM${"b".repeat(32)}`,
      From: customer.phone,
      MessagingServiceSid: serviceSid,
      OptOutType: "STOP",
    });

    const audience = await operationalPilotAudience(db, fixture.runId);
    assert.deepEqual(
      audience.included.map((entry) => entry.member_id),
      [member.id],
    );
    assert.equal(audience.excluded.length, 0);
    assert.equal(
      (await db.query("select * from member_service_events")).length,
      0,
    );
    assert.equal(
      (
        await db.query<{ consent_action: string }>(
          "select consent_action from member_consents where member_id=$1 order by sequence desc limit 1",
          [member.id],
        )
      )[0].consent_action,
      "stop",
    );

    const published = await releaseWeeklyBenefits(
      db,
      fixture.actor,
      releaseInput(fixture, [member.id], "stop-included-release"),
    );
    assert.equal(published.grants.length, 1);
    assert.equal(published.grants[0].member_id, member.id);
  });
});

test("a geography observation preserves the member's previous service status", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 1, "geography-status");
    const member = fixture.members[0];
    const withdrawalId = await record(
      db,
      { memberId: member.id },
      member.id,
      "withdrawn",
      "geography-withdrawal",
    );
    await record(
      db,
      { memberId: member.id },
      member.id,
      "geography_changed",
      "geography-observation",
    );

    const status = await memberServiceStatus(db, member.id);
    assert.equal(status?.event_id, withdrawalId);
    assert.equal(status?.kind, "withdrawn");
    assert.equal(status?.blocks_future_release, true);
    const events = await db.query<{ kind: string }>(
      "select kind from member_service_events where member_id=$1 order by sequence",
      [member.id],
    );
    assert.deepEqual(
      events.map((event) => event.kind),
      ["withdrawn", "geography_changed"],
    );
  });
});

test("suspension revokes existing sessions and recovery codes and blocks access", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 1, "suspend-access");
    const member = fixture.members[0];
    const privateAccess = token();
    await db.query(
      `insert into member_access(
        id,member_id,token_hash,token_encrypted,purpose,expires_at,confirmed_at,
        disclosure,home_zip,age_attested
       ) values('suspend-access-link',$1,$2,$3,'access',now()+interval '1 day',now(),
        'Synthetic account access','10001',true)`,
      [member.id, hash(privateAccess), encrypt(privateAccess)],
    );
    const session = await createMemberSession(
      db,
      member.id,
      "suspend-access-link",
    );
    const recoveryCodes = await replaceMemberRecoveryCodes(db, member.id);

    await record(
      db,
      fixture.actor,
      member.id,
      "suspended",
      "suspend-account-event",
    );

    assert.equal(await memberSession(db, session.credential), null);
    await assert.rejects(
      memberAccess(db, privateAccess, true),
      /account needs Uptick support/i,
    );
    const [customer] = await db.query<{ phone: string }>(
      "select phone from customers where id=$1",
      [member.customerId],
    );
    await assert.rejects(
      recoverMemberSession(db, {
        phone: customer.phone,
        code: recoveryCodes[0],
      }),
      /recovery code/i,
    );
    await assert.rejects(
      requestMemberAccess(db, {
        phone: customer.phone,
        ageAttested: true,
        consentRequested: false,
      }),
      /account needs Uptick support/i,
    );
  });
});

test("operator resume is append-only, auditable, and permits fresh access", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 1, "resume-account");
    const member = fixture.members[0];
    const suspendedId = await record(
      db,
      fixture.actor,
      member.id,
      "suspended",
      "resume-suspension",
    );
    const resumedId = await record(
      db,
      fixture.actor,
      member.id,
      "resumed",
      "resume-restoration",
    );

    const status = await memberServiceStatus(db, member.id);
    assert.equal(status?.event_id, resumedId);
    assert.equal(status?.kind, "resumed");
    assert.equal(status?.blocks_future_release, false);
    assert.equal(status?.blocks_account_access, false);
    assert.deepEqual(
      (
        await db.query<{ id: string }>(
          "select id from member_service_events where member_id=$1 order by sequence",
          [member.id],
        )
      ).map((event) => event.id),
      [suspendedId, resumedId],
    );
    const [resumeAudit] = await db.query<{
      detail: { previousEventId: string; kind: string };
    }>(
      "select detail from audit_events where action='member_service_disposition' and entity_id=$1",
      [resumedId],
    );
    assert.equal(resumeAudit.detail.previousEventId, suspendedId);
    assert.equal(resumeAudit.detail.kind, "resumed");

    const fresh = await createMemberSession(db, member.id);
    assert.ok(await memberSession(db, fresh.credential));
  });
});
