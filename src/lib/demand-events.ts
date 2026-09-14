import type { DB } from "./db";
import { id } from "./security";

export async function demandEvent(
  db: DB,
  input: {
    kind: string;
    memberId?: string | null;
    marketId?: string | null;
    organizationId?: string | null;
    locationId?: string | null;
    sourceId?: string | null;
    supplyId?: string | null;
    allocationId?: string | null;
    claimId?: string | null;
    detail?: object;
    dedupKey?: string;
    evidenceClass?: string;
  },
) {
  await db.query(
    `insert into demand_events(id,kind,member_id,market_id,organization_id,location_id,source_id,supply_id,allocation_id,claim_id,detail,dedup_key,evidence_class) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict(dedup_key) do nothing`,
    [
      id(),
      input.kind,
      input.memberId || null,
      input.marketId || null,
      input.organizationId || null,
      input.locationId || null,
      input.sourceId || null,
      input.supplyId || null,
      input.allocationId || null,
      input.claimId || null,
      input.detail || {},
      input.dedupKey || null,
      input.evidenceClass || "observed",
    ],
  );
}
