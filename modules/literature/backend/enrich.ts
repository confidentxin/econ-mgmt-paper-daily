// Periodic OpenAlex enrichment: fills missing abstracts on recently discovered Crossref papers (notably Elsevier)
// and queues them for editorial scoring once an abstract arrives.
import { sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { MODULE } from "./collect.ts";
import { fetchOpenAlexAbstracts, normalizeDoi } from "./openalex.ts";

const BATCH_LIMIT = 200;

interface MissingAbstractRow {
  id: string;
  source_id: string;
  url: string;
  title: string;
  author: string | null;
  published_at: Date | null;
  publication_time: string | null;
  raw: Record<string, unknown> | null;
}

export async function enrichOpenAlex(now = new Date()): Promise<Record<string, unknown>> {
  const started = Date.now();
  const candidates = await sql<MissingAbstractRow[]>`
    SELECT a.id, a.source_id, a.url, a.title, a.author, a.published_at, a.publication_time, a.raw
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE s.enabled = true
      AND a.raw ? 'doi'
      AND coalesce(a.excerpt, '') = ''
      AND coalesce(a.body_text, '') = ''
      AND a.discovered_at > ${now}::timestamptz - interval '14 days'
      AND (
        NOT (a.raw ? 'openalexCheckedAt')
        OR (a.raw->>'openalexCheckedAt')::timestamptz < ${now}::timestamptz - interval '24 hours'
      )
    ORDER BY a.discovered_at DESC
    LIMIT ${BATCH_LIMIT}`;

  if (!candidates.length) {
    return { candidates: 0, requests: 0, enriched: 0, queued: 0, stillMissing: 0, ms: Date.now() - started };
  }

  const dois = candidates
    .map((row) => normalizeDoi(typeof row.raw?.doi === "string" ? row.raw.doi : row.url))
    .filter((d): d is string => d !== null);

  const { abstracts, requests } = await fetchOpenAlexAbstracts(dois);
  const checkedAt = now.toISOString();
  let enriched = 0;
  let queued = 0;
  let stillMissing = 0;

  for (const row of candidates) {
    const doi = normalizeDoi(typeof row.raw?.doi === "string" ? row.raw.doi : row.url);
    const abstract = doi ? abstracts.get(doi) ?? null : null;
    const baseRaw = row.raw && typeof row.raw === "object" ? row.raw : {};

    if (!abstract) {
      stillMissing += 1;
      const nextRaw = { ...baseRaw, openalexCheckedAt: checkedAt };
      await sql`UPDATE articles SET raw = ${sql.json(nextRaw as never)} WHERE id = ${row.id}`;
      continue;
    }

    const nextRaw = { ...baseRaw, abstractSource: "openalex", openalexCheckedAt: checkedAt };
    const res = await upsertMaterial({
      sourceId: row.source_id,
      url: row.url,
      title: row.title,
      author: row.author,
      publishedAt: row.published_at,
      publicationTime: row.publication_time,
      excerpt: abstract,
      bodyStatus: "none",
      raw: nextRaw,
      via: MODULE,
    });
    await sql`UPDATE articles SET body_status = 'none', raw = ${sql.json(nextRaw as never)}
      WHERE id = ${res.articleId} AND (body_status = 'pending' OR body_status = 'unconfirmed' OR NOT (raw ? 'abstractSource'))`;
    enriched += 1;
    await queueProcessing(res.articleId);
    queued += 1;
  }

  return { candidates: candidates.length, requests, enriched, queued, stillMissing, ms: Date.now() - started };
}
