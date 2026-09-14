import type { DB } from "./db";
import { saveDraft, type Actor } from "./domain";
import {
  assertLocalSeedEnvironment,
  assertNoRealPilotData,
} from "./seed-safety";
export async function seed(db: DB) {
  assertLocalSeedEnvironment();
  await assertNoRealPilotData(db);
  if ((await db.query("select id from organizations where id='joes'")).length)
    return;
  await db.transaction(async (tx) => {
    for (const [org, name, cap] of [
      ["joes", "Joe’s Fuel & Go", "merchant"],
      ["carwash", "Main Street Car Wash", "host"],
      ["lube", "Quick Lube", "host"],
      ["tire", "Ridge Tire", "host"],
      ["second", "Maple Corner Café", "merchant"],
    ]) {
      await tx.query(
        "insert into organizations(id,name,capabilities,is_demo) values($1,$2,$3,true)",
        [org, name, [cap]],
      );
      await tx.query(
        "insert into locations(id,organization_id,name,address) values($1,$2,$3,$4)",
        [
          `${org}-location`,
          org,
          "Main location",
          org === "joes"
            ? "118 Main Street · Illustrative pilot address"
            : "Illustrative pilot location",
        ],
      );
      if (cap === "merchant")
        await tx.query(
          "insert into senders(id,organization_id) values($1,$2)",
          [`${org}-sender`, org],
        );
    }
    await tx.query(
      "insert into memberships(user_id,organization_id,role,can_export) values('local-merchant','joes','merchant',true),('local-operator','joes','operator',true),('local-second','second','merchant',true)",
    );
    await tx.query(
      "insert into offers(id,organization_id,location_id,kind,state,title) values('joes-anchor','joes','joes-location','anchor','live','Fuel your day'),('second-anchor','second','second-location','anchor','live','A little extra, on us')",
    );
    for (const offerId of ["joes-anchor", "second-anchor"])
      await tx.query(
        "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values($1,1,$2,$3,$4,now()-interval '1 day',now()+interval '90 days')",
        [
          offerId,
          offerId === "joes-anchor" ? "Buy $25 of gas" : "Buy a pastry",
          "Get a free large coffee",
          "One per customer. Same-visit qualifying purchase required. Show your receipt to the cashier. Cannot be combined with other offers.",
        ],
      );
    for (const [host, name, status] of [
      ["carwash", "Waiting area · Display 01", "confirmed"],
      ["lube", "Customer lounge · Display 01", "confirmed"],
      ["tire", "Front desk · Display 01", "intended"],
    ]) {
      await tx.query(
        "insert into placements(id,location_id,name,status,external_reference) values($1,$2,$3,$4,$5)",
        [
          `${host}-placement`,
          `${host}-location`,
          name,
          status,
          `MANUAL-${host.toUpperCase()}`,
        ],
      );
      await tx.query(
        "insert into sources(id,token,offer_id,placement_id,campaign,creative) values($1,$2,$3,$4,$5,$6)",
        [
          `${host}-source`,
          `pilot-${host}-2026`,
          "joes-anchor",
          `${host}-placement`,
          "Joe’s neighborhood pilot",
          "Fuel + coffee · creative 01",
        ],
      );
    }
  });
  const actor: Actor = {
    id: "local-merchant",
    role: "merchant",
    organizationId: "joes",
  };
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setUTCHours(13, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(20, 0, 0, 0);
  await saveDraft(db, actor, {
    organizationId: "joes",
    title: "The breakfast Drop",
    qualification: "Buy a breakfast sandwich",
    reward: "Get a free large coffee",
    terms:
      "One per customer. Qualifying sandwich purchase required. Show your pass to the cashier.",
    startsAt: start.toISOString(),
    expiresAt: end.toISOString(),
    limitMode: "unlimited",
    submit: false,
  });
}
