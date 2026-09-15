import { getDb } from "../src/lib/db";
import { seedDemoStudio } from "../src/lib/demo-studio";
const db = await getDb();
try {
  await seedDemoStudio(db);
  console.log(
    "Demo dataset ready: four sample weeks; isolated sample member and stock; no real SMS.",
  );
} finally {
  await db.close?.();
}
