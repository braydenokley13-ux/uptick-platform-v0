import { getDb } from "../src/lib/db";
import { seedNetwork } from "../src/lib/network-seed";
import { assertLocalSeedEnvironment } from "../src/lib/seed-safety";
try {
  process.loadEnvFile(".env.local");
} catch {}
assertLocalSeedEnvironment();
await seedNetwork(await getDb());
console.log(
  "Illustrative pilot seeded. No customer activity or delivery metrics fabricated.",
);
process.exit(0);
