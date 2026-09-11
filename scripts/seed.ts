import { getDb } from "../src/lib/db";
import { seedNetwork } from "../src/lib/network-seed";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (process.env.UPTICK_LOCAL_MODE !== "true")
  throw Error(
    "Demo seed requires explicit local mode. Use operator setup for real businesses.",
  );
await seedNetwork(await getDb());
console.log(
  "Illustrative pilot seeded. No customer activity or delivery metrics fabricated.",
);
process.exit(0);
