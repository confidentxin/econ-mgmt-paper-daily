// Syncs journal tiers, selection_class and tags from industry/sources.json onto an existing database
// without overwriting admin enabled/disabled toggles.
// Usage: node --env-file=.env modules/literature/scripts/sync-sources.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";

interface JournalSource {
  id: string;
  tier: string;
  selection_class?: string | null;
  tags?: string[];
}

const { sources } = JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/sources.json"), "utf8")) as { sources: JournalSource[] };
let updated = 0;
for (const s of sources) {
  const nextClass = s.selection_class ?? null;
  const nextTags = s.tags ?? [];
  const res = await sql`
    UPDATE sources
    SET tier = ${s.tier}, selection_class = ${nextClass}, tags = ${nextTags}, updated_at = now()
    WHERE id = ${s.id}
      AND (tier IS DISTINCT FROM ${s.tier} OR selection_class IS DISTINCT FROM ${nextClass} OR tags IS DISTINCT FROM ${nextTags}::text[])
    RETURNING id`;
  updated += res.length;
}
console.log(`journal sources synced: ${updated} updated out of ${sources.length}`);
await closeDb();
