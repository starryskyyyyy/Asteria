import { rm } from 'node:fs/promises';

// Removes every build artefact. Kept dependency-free so `npm run clean` works on a fresh clone.
const targets = ['dist', 'release'];
for (const target of targets) {
  await rm(target, { recursive: true, force: true });
  console.log(`removed ${target}/`);
}
