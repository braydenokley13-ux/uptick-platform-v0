import type { DB } from "./db";
import { id } from "./security";

// Work is bounded by the caller. A lease prevents overlapping workers; uncertain
// external sends stay in the messaging ledger and are never replayed here.
export async function runScheduledJob(
  db: DB,
  jobKey: string,
  work: () => Promise<number>,
) {
  if (
    !["membership_prepare", "membership_dispatch", "legacy_dispatch"].includes(
      jobKey,
    )
  )
    throw Error("Unknown scheduled job");
  const runId = id();
  const acquired = await db.transaction(async (tx) => {
    const [lease] = await tx.query(
      "insert into scheduled_job_leases(job_key,owner_token,expires_at) values($1,$2,now()+interval '90 seconds') on conflict(job_key) do update set owner_token=excluded.owner_token,expires_at=excluded.expires_at where scheduled_job_leases.expires_at<now() returning job_key",
      [jobKey, runId],
    );
    if (!lease) return false;
    await tx.query(
      "update scheduled_job_runs set state='interrupted',finished_at=now(),error_code='lease_expired' where job_key=$1 and state='running'",
      [jobKey],
    );
    await tx.query(
      "insert into scheduled_job_runs(id,job_key,state) values($1,$2,'running')",
      [runId, jobKey],
    );
    return true;
  });
  if (!acquired) return { state: "busy" as const, processed: 0 };
  try {
    const processed = await work();
    await db.query(
      "update scheduled_job_runs set state='succeeded',processed=$2,finished_at=now() where id=$1 and state='running'",
      [runId, processed],
    );
    return { state: "succeeded" as const, processed };
  } catch (error) {
    await db.query(
      "update scheduled_job_runs set state='failed',finished_at=now(),error_code='worker_failed' where id=$1 and state='running'",
      [runId],
    );
    throw error;
  } finally {
    await db.query(
      "delete from scheduled_job_leases where job_key=$1 and owner_token=$2",
      [jobKey, runId],
    );
  }
}
export async function scheduledJobHealth(db: DB) {
  return db.query<{
    job_key: string;
    state: string;
    started_at: string;
    finished_at: string | null;
    processed: number;
    error_code: string | null;
    last_success: string | null;
  }>(
    "select distinct on (job_key) j.*,(select max(s.finished_at) from scheduled_job_runs s where s.job_key=j.job_key and s.state='succeeded') last_success from scheduled_job_runs j order by job_key,started_at desc",
  );
}
