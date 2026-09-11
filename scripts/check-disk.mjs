import { statfsSync } from "node:fs";

// Check available bytes, not total free bytes reserved for the operating system.
// This does not delete files or inspect unrelated project data.
const minimumMiB = Number(process.argv[2]);
const operation = process.argv[3] || "this operation";
if (!Number.isFinite(minimumMiB) || minimumMiB < 1) {
  throw new Error("Provide a positive minimum disk margin in MiB.");
}
const stats = statfsSync(process.cwd());
const availableMiB = Math.floor((stats.bavail * stats.bsize) / 1024 ** 2);
if (availableMiB < minimumMiB) {
  console.error(
    `${operation} paused before writing: ${availableMiB} MiB available; ${minimumMiB} MiB required. Free disk space, then retry. Source files and local database are unchanged.`,
  );
  process.exitCode = 1;
} else {
  console.log(`Disk check: ${availableMiB} MiB available for ${operation}.`);
}
