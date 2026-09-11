import type { DB } from "./db";
import { seed } from "./seed";
import { localMode } from "./config";
import { token, id } from "./security";
import { marketWeekWindow } from "./network";
import { audit } from "./domain";

// An explicit local rehearsal fixture. No members, claims, messages, or redemptions are invented.
export async function seedNetwork(db: DB) {
  if (!localMode())
    throw Error(
      "The sample Market Cell can only be seeded in explicit local development.",
    );
  await seed(db);
  await db.transaction(async (tx) => {
    await tx.query("select id from organizations where id='joes' for update");
    if (
      (
        await tx.query(
          "select id from market_cells where id='sample-river-market'",
        )
      ).length
    )
      return;
    const [safe] = await tx.query(
      "select id from organizations where id='joes' and is_demo",
    );
    if (!safe) throw Error("The sample seed cannot change a real business.");
    await tx.query(
      "insert into market_cells(id,name,slug,state,boundary_note,center_latitude,center_longitude) values('sample-river-market','River Neighborhood','river-neighborhood','pilot','Illustrative pilot trade area. ZIP inclusion is an operating approximation, not a measured drive-time boundary.',40.989000,-73.801000)",
    );
    await tx.query(
      "insert into market_zips(market_id,zip) values('sample-river-market','10583'),('sample-river-market','10530'),('sample-river-market','10606')",
    );
    // Retire the café sample name for new work; earlier issued pass snapshots remain unchanged.
    await tx.query(
      "update organizations set name='Northside Fuel & Market' where id='second' and is_demo",
    );
    for (const [org, address, lat, lng, minutes] of [
      [
        "joes",
        "118 Main Street · Illustrative sample location",
        40.986,
        -73.803,
        4,
      ],
      [
        "second",
        "24 Northside Road · Illustrative sample location",
        40.994,
        -73.793,
        7,
      ],
    ] as const) {
      await tx.query(
        "update locations set address=$2,latitude=$3,longitude=$4,postal_code='10583' where id=$1",
        [`${org}-location`, address, lat, lng],
      );
      await tx.query(
        "insert into business_profiles(organization_id,category,growth_goal) values($1,'Gas station + convenience store','Bring nearby Uptick members inside for something worthwhile.') on conflict(organization_id) do update set category=excluded.category,growth_goal=excluded.growth_goal",
        [org],
      );
      await tx.query(
        "insert into market_locations(market_id,location_id,organization_id,drive_minutes) values('sample-river-market',$1,$2,$3)",
        [`${org}-location`, org, minutes],
      );
      await tx.query(
        "insert into merchant_growth_preferences(organization_id,objective,objective_note,verification_preference,updated_by) values($1,'store_visits','Make the convenience store a useful local destination.','public_tap','local-operator') on conflict do nothing",
        [org],
      );
      for (const exposure of ["public", "staff"]) {
        const pointId = `sample-${org}-${exposure}-tap`;
        await tx.query(
          "insert into redemption_points(id,organization_id,location_id,name,exposure,created_by) values($1,$2,$3,$4,$5,'local-operator')",
          [
            pointId,
            org,
            `${org}-location`,
            exposure === "public"
              ? "Customer counter · sample"
              : "Cashier presents · sample",
            exposure,
          ],
        );
        await tx.query(
          "insert into redemption_credentials(id,point_id,public_token,credential_type,version,created_by) values($1,$2,$3,'qr',1,'local-operator')",
          [id(), pointId, token()],
        );
      }
    }
    for (const [partner, name, kind, channel, cost, lat, lng] of [
      [
        "river-house",
        "River House Residents",
        "apartment",
        "resident newsletter",
        0,
        40.987,
        -73.795,
      ],
      [
        "main-carwash",
        "Main Street Car Wash",
        "auto business",
        "waiting-area screen",
        null,
        40.982,
        -73.808,
      ],
      [
        "north-office",
        "Northside Works",
        "employer",
        "employee benefit",
        0,
        40.998,
        -73.8,
      ],
    ] as const) {
      await tx.query(
        "insert into acquisition_partners(id,name,kind,agreement_note,address,latitude,longitude) values($1,$2,$3,'Illustrative sample partnership; no real agreement asserted.','Illustrative sample location',$4,$5)",
        [partner, name, kind, lat, lng],
      );
      await tx.query(
        "insert into partner_markets(partner_id,market_id) values($1,'sample-river-market')",
        [partner],
      );
      await tx.query(
        "insert into acquisition_sources(id,partner_id,market_id,token,name,channel,campaign,cost) values($1,$2,'sample-river-market',$2,$3,$4,'Sample neighborhood introduction',$5)",
        [
          `${partner}-membership`,
          partner,
          `${name} · Join Uptick`,
          channel,
          cost,
        ],
      );
    }
    const week = marketWeekWindow(new Date(), "America/New_York");
    for (let offset = 0; offset < 4; offset++) {
      const window = marketWeekWindow(
        new Date(week.start.getTime() + offset * 7 * 86400000 + 12 * 3600000),
        "America/New_York",
      );
      for (const [org, reward, retail, cost] of [
        [
          "joes",
          offset % 2 === 0 ? "Free large coffee" : "Free fountain drink",
          2.49,
          0.42,
        ],
        [
          "second",
          offset % 2 === 0 ? "Free fountain drink" : "Free snack",
          2.29,
          0.55,
        ],
      ] as const) {
        const offerId = `sample-${org}-uptick-${window.weekKey}`;
        const qualification =
          "Visit the convenience store. No purchase required";
        const instructions =
          "1. Welcome the Uptick member. 2. Ask them to tap or scan the counter sign. 3. Wait for the green UPTICK REDEEMED screen. 4. Give one listed free item.";
        await tx.query(
          "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','review',$4)",
          [offerId, org, `${org}-location`, `${reward} · ${window.weekKey}`],
        );
        await tx.query(
          "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values($1,1,$2,$3,$4,$5,$6)",
          [
            offerId,
            qualification,
            reward,
            "One chosen Uptick per member per week. At the named location during opening hours. No purchase required. Available until the stated redemption quantity is reached. Sample rehearsal only.",
            window.start.toISOString(),
            window.end.toISOString(),
          ],
        );
        await tx.query(
          "insert into offer_product_metadata(offer_id,version,goal,customer_value,reward_cost,required_purchase,staff_instructions) values($1,1,'store_visits',$2,$3,0,$4)",
          [offerId, retail, cost, instructions],
        );
        await tx.query(
          "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,verification_mode,staff_instructions,fallback_plan,shareable,referral_cap,spend_cap,approved_by) values($1,'sample-river-market',$2,$3,$1,1,'approved',$4,$5,'redemption',100,'public_tap',$6,'Pause new claims if the item runs out. Ask Uptick to arrange another available Drop.',true,5,$7,'local-operator')",
          [
            offerId,
            org,
            `${org}-location`,
            window.start.toISOString(),
            window.end.toISOString(),
            instructions,
            cost * 100,
          ],
        );
        await audit(
          tx,
          "local-operator",
          org,
          "network.supply_sample_seeded",
          offerId,
          { sample: true, week: window.weekKey },
        );
      }
    }
    await audit(
      tx,
      "local-operator",
      null,
      "network.sample_market_seeded",
      "sample-river-market",
      { sample: true, membersCreated: 0, physicalInstallationsConfirmed: 0 },
    );
  });
}
