import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createClient,
  type SupabaseClient,
  type SupportedStorage,
} from "@supabase/supabase-js";
import { memoryDb } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import {
  accountRecoveryOptions,
  assignBusinessAccess,
  assertFactorAction,
  revokeAccountSession,
  revokeBusinessAccess,
  verifyAccountIdentity,
} from "../src/lib/account-security";

process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";

const operatorId = "11111111-1111-4111-8111-111111111111";
const merchantId = "22222222-2222-4222-8222-222222222222";
const targetId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherSessionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const operator: Actor = {
  id: operatorId,
  role: "operator",
  organizationId: "account-operator-org",
};
const merchant: Actor = {
  id: merchantId,
  role: "merchant",
  organizationId: "account-merchant-org",
};

function accountToken(
  userId: string,
  activeSessionId: string,
  options: { aal?: "aal1" | "aal2"; expiresAt?: number } = {},
) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    session_id: activeSessionId,
    sub: userId,
    aal: options.aal || "aal1",
    exp: options.expiresAt || Math.floor(Date.now() / 1000) + 3600,
  })}.test-signature`;
}

function providerClient(
  user: {
    id: string;
    email?: string;
    factors?: { status: "verified" | "unverified" }[];
  } | null,
  error: object | null = null,
) {
  return {
    auth: {
      getUser: async () => ({ data: { user }, error }),
    },
  } as unknown as SupabaseClient;
}

async function accountDb() {
  const db = await memoryDb();
  await db.query("create schema if not exists auth");
  await db.query(`create table auth.users (
    id uuid primary key,
    email text,
    email_confirmed_at timestamptz,
    deleted_at timestamptz,
    banned_until timestamptz
  )`);
  await db.query(`create table auth.sessions (
    id uuid primary key,
    user_id uuid not null,
    created_at timestamptz not null default now()
  )`);
  return db;
}

test("factor actions stay inside the account and require verified backup access", () => {
  const verified = {
    id: "factor-primary",
    name: "Primary authenticator",
    status: "verified" as const,
    type: "totp" as const,
  };
  const backup = {
    id: "factor-backup",
    name: "Backup authenticator",
    status: "verified" as const,
    type: "totp" as const,
  };
  const unfinished = {
    id: "factor-unfinished",
    name: "Unfinished authenticator",
    status: "unverified" as const,
    type: "totp" as const,
  };

  assert.throws(
    () => assertFactorAction("verify", "aal2", [verified], "other-user-factor"),
    /this account's authenticators/i,
  );
  assert.throws(
    () => assertFactorAction("remove", "aal2", [verified], "missing-factor"),
    /this account's authenticators/i,
  );
  assert.throws(
    () => assertFactorAction("enroll", "aal1", [verified]),
    /verify an existing authenticator/i,
  );
  assert.throws(
    () =>
      assertFactorAction(
        "verify",
        "aal1",
        [verified, unfinished],
        unfinished.id,
      ),
    /verify an existing authenticator/i,
  );
  assert.throws(
    () => assertFactorAction("remove", "aal2", [verified], verified.id),
    /keep another working authenticator/i,
  );
  assert.throws(
    () => assertFactorAction("remove", "aal1", [verified, backup], verified.id),
    /verify your session/i,
  );

  assert.doesNotThrow(() => assertFactorAction("enroll", "aal2", [verified]));
  assert.doesNotThrow(() =>
    assertFactorAction("verify", "aal2", [verified, unfinished], unfinished.id),
  );
  assert.doesNotThrow(() =>
    assertFactorAction("remove", "aal2", [verified, backup], verified.id),
  );
  assert.doesNotThrow(() =>
    assertFactorAction("verify", "aal1", [unfinished], unfinished.id),
  );
});

test("a verified phone factor prevents AAL1 enrollment or verification of a new TOTP", () => {
  const verifiedPhone = {
    id: "provider-phone-factor",
    name: "Verified phone",
    status: "verified" as const,
    type: "phone" as const,
  };
  const unfinishedTotp = {
    id: "new-totp-factor",
    name: "New authenticator",
    status: "unverified" as const,
    type: "totp" as const,
  };

  assert.throws(
    () => assertFactorAction("enroll", "aal1", [verifiedPhone]),
    /verify an existing authenticator/i,
  );
  assert.throws(
    () =>
      assertFactorAction(
        "verify",
        "aal1",
        [verifiedPhone, unfinishedTotp],
        unfinishedTotp.id,
      ),
    /verify an existing authenticator/i,
  );
  assert.throws(
    () =>
      assertFactorAction(
        "remove",
        "aal2",
        [verifiedPhone, unfinishedTotp],
        verifiedPhone.id,
      ),
    /different factor type/i,
  );
});

test("the installed Supabase SDK keeps two concurrent recovery PKCE flows isolated", async () => {
  type RecoveryRequest = {
    email: string;
    callback: URL;
    flowId: string;
    challenge: string;
    code: string;
    verifier?: string;
    consumed: boolean;
  };

  const values = new Map<string, string>();
  const storage: SupportedStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
  const requests = new Map<string, RecoveryRequest>();
  let tokenAttempts = 0;

  const fakeFetch: typeof fetch = async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(requestUrl);
    const body = JSON.parse(String(init?.body || "{}")) as Record<
      string,
      string
    >;

    if (url.pathname.endsWith("/recover")) {
      const callback = new URL(url.searchParams.get("redirect_to") || "");
      const flowId = callback.searchParams.get("sb_flow_id");
      assert.ok(flowId, "the SDK must append sb_flow_id to the callback URL");
      assert.equal(body.code_challenge_method, "s256");
      const request: RecoveryRequest = {
        email: body.email,
        callback,
        flowId,
        challenge: body.code_challenge,
        code: `recovery-code-${requests.size + 1}`,
        consumed: false,
      };
      requests.set(request.email, request);
      return Response.json({});
    }

    if (url.pathname.endsWith("/token")) {
      tokenAttempts += 1;
      const request = [...requests.values()].find(
        (candidate) => candidate.code === body.auth_code,
      );
      const verifierChallenge = createHash("sha256")
        .update(body.code_verifier || "")
        .digest("base64url");
      if (
        !request ||
        request.consumed ||
        verifierChallenge !== request.challenge
      ) {
        return Response.json(
          { code: "bad_code_verifier", message: "PKCE verifier rejected" },
          {
            status: 400,
            headers: { "x-supabase-api-version": "2024-01-01" },
          },
        );
      }
      request.verifier = body.code_verifier;
      request.consumed = true;
      const userId =
        request.email === "first@example.test" ? targetId : otherUserId;
      return Response.json({
        access_token: accountToken(
          userId,
          request.email === "first@example.test" ? sessionId : secondSessionId,
        ),
        refresh_token: `refresh-${request.code}`,
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: request.email,
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-09-15T00:00:00.000Z",
        },
      });
    }

    return Response.json(
      { message: "Unexpected fake endpoint" },
      { status: 404 },
    );
  };

  const client = createClient(
    "https://local-auth.example.test",
    "local-anon-key",
    {
      ...accountRecoveryOptions(storage),
      global: { fetch: fakeFetch },
    },
  );
  const redirectTo = "https://app.example.test/account/recovery";

  const [firstReset, secondReset] = await Promise.all([
    client.auth.resetPasswordForEmail("first@example.test", { redirectTo }),
    client.auth.resetPasswordForEmail("second@example.test", { redirectTo }),
  ]);
  assert.equal(firstReset.error, null);
  assert.equal(secondReset.error, null);

  const first = requests.get("first@example.test");
  const second = requests.get("second@example.test");
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.flowId, second.flowId);
  assert.notEqual(first.challenge, second.challenge);
  assert.equal(first.callback.origin + first.callback.pathname, redirectTo);
  assert.equal(second.callback.origin + second.callback.pathname, redirectTo);
  assert.equal(first.callback.searchParams.get("sb_flow_id"), first.flowId);
  assert.equal(second.callback.searchParams.get("sb_flow_id"), second.flowId);

  const secondExchange = await client.auth.exchangeCodeForSession(second.code, {
    flowId: second.flowId,
  });
  assert.equal(secondExchange.error, null);
  assert.equal(secondExchange.data.user?.email, "second@example.test");

  const firstExchange = await client.auth.exchangeCodeForSession(first.code, {
    flowId: first.flowId,
  });
  assert.equal(firstExchange.error, null);
  assert.equal(firstExchange.data.user?.email, "first@example.test");
  assert.equal(
    createHash("sha256")
      .update(first.verifier || "")
      .digest("base64url"),
    first.challenge,
  );
  assert.equal(
    createHash("sha256")
      .update(second.verifier || "")
      .digest("base64url"),
    second.challenge,
  );

  const attemptsBeforeReplay = tokenAttempts;
  const replay = await client.auth.exchangeCodeForSession(first.code, {
    flowId: first.flowId,
  });
  assert.match(replay.error?.message || "", /code verifier/i);
  assert.equal(tokenAttempts, attemptsBeforeReplay);
});

test("identity verification requires provider approval and a live matching provider session", async () => {
  const db = await accountDb();
  try {
    await db.query(
      "insert into auth.sessions(id,user_id) values($1::uuid,$2::uuid)",
      [sessionId, targetId],
    );
    const client = providerClient({
      id: targetId,
      email: "security@example.test",
      factors: [{ status: "verified" }],
    });
    const token = accountToken(targetId, sessionId, { aal: "aal2" });
    const identity = await verifyAccountIdentity(db, token, client);
    assert.equal(identity.userId, targetId);
    assert.equal(identity.email, "security@example.test");
    assert.equal(identity.hasVerifiedFactor, true);
    assert.equal(identity.claims.session_id, sessionId);
    assert.equal(identity.claims.aal, "aal2");

    await assert.rejects(
      verifyAccountIdentity(
        db,
        token,
        providerClient(null, { message: "provider rejected token" }),
      ),
      /session has expired/i,
    );
    await assert.rejects(
      verifyAccountIdentity(db, accountToken(otherUserId, sessionId), client),
      /session has expired/i,
    );
    await assert.rejects(
      verifyAccountIdentity(
        db,
        accountToken(targetId, secondSessionId),
        client,
      ),
      /session was revoked/i,
    );
    await assert.rejects(
      verifyAccountIdentity(
        db,
        accountToken(targetId, sessionId, {
          expiresAt: Math.floor(Date.now() / 1000) - 1,
        }),
        client,
      ),
      /session has expired/i,
    );
  } finally {
    await db.close?.();
  }
});

test("application revocation immediately blocks an otherwise valid provider session", async () => {
  const db = await accountDb();
  try {
    await db.query(
      "insert into auth.sessions(id,user_id) values($1::uuid,$2::uuid)",
      [sessionId, targetId],
    );
    const client = providerClient({ id: targetId });
    const token = accountToken(targetId, sessionId);
    const identity = await verifyAccountIdentity(db, token, client);
    await revokeAccountSession(db, identity, "Account owner signed out");

    const [revocation] = await db.query<{
      session_id: string;
      user_id: string;
      reason: string;
    }>(
      "select session_id,user_id,reason from account_session_revocations where session_id=$1",
      [sessionId],
    );
    assert.deepEqual(revocation, {
      session_id: sessionId,
      user_id: targetId,
      reason: "Account owner signed out",
    });
    const [event] = await db.query<{
      actor: string;
      action: string;
      entity_id: string;
    }>(
      "select actor,action,entity_id from audit_events where action='account.session_revoked'",
    );
    assert.deepEqual(event, {
      actor: targetId,
      action: "account.session_revoked",
      entity_id: sessionId,
    });
    await assert.rejects(
      verifyAccountIdentity(db, token, client),
      /session was revoked/i,
    );
  } finally {
    await db.close?.();
  }
});

test("business access assignment requires a confirmed provider account and stays in the chosen business", async () => {
  const db = await accountDb();
  try {
    await db.query(
      `insert into organizations(id,name) values
       ('account-operator-org','Operator organization'),
       ('account-target-one','Target organization one'),
       ('account-target-two','Target organization two')`,
    );
    await db.query(
      `insert into auth.users(id,email,email_confirmed_at) values
       ($1::uuid,'operator@example.test',now()),
       ($2::uuid,'target@example.test',now()),
       ($3::uuid,'unconfirmed@example.test',null)`,
      [operatorId, targetId, otherUserId],
    );

    await assert.rejects(
      assignBusinessAccess(db, merchant, {
        email: "target@example.test",
        organizationId: "account-target-one",
        role: "merchant",
      }),
      /operator access/i,
    );
    await assert.rejects(
      assignBusinessAccess(db, operator, {
        email: "unconfirmed@example.test",
        organizationId: "account-target-one",
        role: "merchant",
      }),
      /create and verify this account/i,
    );
    await assert.rejects(
      assignBusinessAccess(db, operator, {
        email: "operator@example.test",
        organizationId: "account-target-one",
        role: "operator",
      }),
      /another operator/i,
    );
    await assert.rejects(
      assignBusinessAccess(db, operator, {
        email: "target@example.test",
        organizationId: "missing-business",
        role: "merchant",
      }),
      /existing business/i,
    );

    await assignBusinessAccess(db, operator, {
      email: "TARGET@example.test",
      organizationId: "account-target-one",
      role: "merchant",
      canExport: true,
    });
    const memberships = await db.query<{
      user_id: string;
      organization_id: string;
      role: string;
      can_export: boolean;
    }>(
      "select user_id,organization_id,role,can_export from memberships where user_id=$1 order by organization_id",
      [targetId],
    );
    assert.deepEqual(memberships, [
      {
        user_id: targetId,
        organization_id: "account-target-one",
        role: "merchant",
        can_export: true,
      },
    ]);
    const [event] = await db.query<{
      actor: string;
      organization_id: string;
      entity_id: string;
      detail: { role: string; canExport: boolean };
    }>(
      "select actor,organization_id,entity_id,detail from audit_events where action='membership.assigned'",
    );
    assert.deepEqual(event, {
      actor: operatorId,
      organization_id: "account-target-one",
      entity_id: targetId,
      detail: { role: "merchant", canExport: true },
    });
  } finally {
    await db.close?.();
  }
});

test("only a different operator can remove business access and all target sessions are revoked", async () => {
  const db = await accountDb();
  try {
    await db.query(
      `insert into organizations(id,name) values
       ('account-operator-org','Operator organization'),
       ('account-merchant-org','Merchant organization'),
       ('account-target-one','Target organization one'),
       ('account-target-two','Target organization two')`,
    );
    await db.query(
      `insert into memberships(user_id,organization_id,role) values
       ($1,'account-operator-org','operator'),
       ($2,'account-merchant-org','merchant'),
       ($3,'account-target-one','merchant'),
       ($3,'account-target-two','operator')`,
      [operatorId, merchantId, targetId],
    );
    await db.query(
      `insert into auth.sessions(id,user_id) values
       ($1::uuid,$2::uuid),($3::uuid,$2::uuid),($4::uuid,$5::uuid)`,
      [sessionId, targetId, secondSessionId, otherSessionId, otherUserId],
    );

    await assert.rejects(
      revokeBusinessAccess(db, merchant, {
        userId: targetId,
        reason: "Merchant attempted to remove another account.",
      }),
      /operator access/i,
    );
    await assert.rejects(
      revokeBusinessAccess(db, operator, {
        userId: operatorId,
        reason: "Acting operator attempted to remove their own access.",
      }),
      /backup operator/i,
    );
    assert.equal(
      (
        await db.query(
          "select organization_id from memberships where user_id=$1",
          [operatorId],
        )
      ).length,
      1,
    );

    await revokeBusinessAccess(db, operator, {
      userId: targetId,
      reason: "Approved offboarding removed this account's business access.",
    });
    assert.equal(
      (
        await db.query(
          "select organization_id from memberships where user_id=$1",
          [targetId],
        )
      ).length,
      0,
    );
    const revocations = await db.query<{
      session_id: string;
      user_id: string;
      reason: string;
    }>(
      "select session_id,user_id,reason from account_session_revocations order by session_id",
    );
    assert.deepEqual(revocations, [
      {
        session_id: sessionId,
        user_id: targetId,
        reason: "Operator removed account access",
      },
      {
        session_id: secondSessionId,
        user_id: targetId,
        reason: "Operator removed account access",
      },
    ]);
    const [event] = await db.query<{
      actor: string;
      entity_id: string;
      detail: { reason: string; organizationCount: number };
    }>(
      "select actor,entity_id,detail from audit_events where action='account.access_removed'",
    );
    assert.equal(event.actor, operatorId);
    assert.equal(event.entity_id, targetId);
    assert.deepEqual(event.detail, {
      reason: "Approved offboarding removed this account's business access.",
      organizationCount: 2,
    });
  } finally {
    await db.close?.();
  }
});
