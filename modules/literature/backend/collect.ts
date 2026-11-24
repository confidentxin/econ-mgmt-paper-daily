// The Crossref collection: every few hours, the works deposited for the followed journals since the last
// run (with an overlap, as Crossref's index can lag its deposits), each stored as an article of its
// journal's source and queued for the engine's analysis. The cursor is the last deposit day read.
import { sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { beijingDate } from "@aihot/contracts/time";
import { fetchDeposits, issnBatches, toPaper } from "./crossref.ts";
import { collectionWindow } from "./window.ts";
import { crossrefIssns, journalByIssn, journals } from "./registry.ts";

export const MODULE = "literature";
const CURSOR = "crossref";
const DAY_MS = 86_400_000;

/** The first run's window starts here; a later one from the stored cursor. */
export async function readCursor(): Promise<string | null> {
  const [row] = await sql<{ created_through: Date }[]>`SELECT created_through FROM literature_cursors WHERE name = ${CURSOR}`;
  return row ? beijingDate(row.created_through) : null;
}

export async function collectCrossref(now = new Date()): Promise<Record<string, unknown>> {
  const started = Date.now();
  const today = beijingDate(now);
  const range = collectionWindow(await readCursor(), today);
  const stats = { requests: 0, found: 0, created: 0, revised: 0, queued: 0, withAbstract: 0, staleOnDiscovery: 0, otherJournal: 0, notAPaper: 0 };
  for (const issns of issnBatches(crossrefIssns())) {
    const { works, requests } = await fetchDeposits(issns, range.from, range.until);
    stats.requests += requests;
    stats.found += works.length;
    for (const work of works) {
      const journal = journalByIssn(work.ISSN ?? []);
      if (!journal) {
        stats.otherJournal += 1;
        continue;
      }
      const paper = toPaper(work, now);
      if (!paper) {
        stats.notAPaper += 1;
        continue;
      }
      if (paper.abstract) stats.withAbstract += 1;
      // More than 48 h after its publication day, the engine archives a paper as history whatever this run does.
      if (now.getTime() - paper.publishedAt.getTime() > 2 * DAY_MS) stats.staleOnDiscovery += 1;
      const res = await upsertMaterial({
        sourceId: journal.sourceId,
        url: paper.url,
        title: paper.title,
        author: paper.author,
        publishedAt: paper.publishedAt,
        publicationTime: paper.publicationTime,
        excerpt: paper.abstract,
        raw: { doi: paper.doi, journal: journal.name, lists: journal.lists, dateBasis: paper.dateBasis, depositedAt: paper.depositedAt?.toISOString() ?? null },
        via: MODULE,
      });
      if (res.created) stats.created += 1;
      if (res.revised) stats.revised += 1;
      if (res.created || res.revised || res.processingNeeded) {
        await queueProcessing(res.articleId);
        stats.queued += 1;
      }
    }
  }
  // Advanced only once every batch was read: a failed run leaves the cursor, and the next one reads the window again.
  await sql`INSERT INTO literature_cursors (name, created_through) VALUES (${CURSOR}, ${range.until})
    ON CONFLICT (name) DO UPDATE SET created_through = EXCLUDED.created_through, runs = literature_cursors.runs + 1, updated_at = now()`;
  await sql`UPDATE sources SET last_fetch_at = now(), last_ok_at = now() WHERE id = ANY(${sql.array(journals().filter((j) => j.crossref).map((j) => j.sourceId))}::text[])`;
  return { ...stats, from: range.from, until: range.until, ms: Date.now() - started };
}
