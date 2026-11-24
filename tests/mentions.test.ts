// The site's own texts link the names of pages it has (contracts/mentions.ts): an article page, an
// event page and a report are sent the extra pages their texts name. Tag topics already have their own
// chips; pages such as a method guide come from installed modules, so a site without them sends none.
// Failure cases: a page a module offers is not sent; a site without modules sends a module's pages or none.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { loadStoryDetail } from "@aihot/backend/publication/stories";
import { loadReport } from "@aihot/backend/publication/reports";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const source = `mentions-${T}`;
const at = new Date("2026-09-30T00:00:00Z");
const methods = [{ name: "methods", mentions: async () => [{ href: "/methods/did", names: ["双重差分"] }] }];
let sequence = 0;

before(async () => {
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,next_fetch_at)
    VALUES (${source},'Mention source','rss','T1','editorial','2100-01-01')`;
});
after(async () => { installModules([]); await stopBoss(); await closeDb(); });

async function article(title: string, summary: string) {
  const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.com/${T}/${++sequence}`, title,
    bodyText: "Fixture body", bodyHtml: "<p>Fixture body</p>", bodyStatus: "ok", via: "fetch", publishedAt: at });
  await sql`UPDATE articles SET grouping_status = 'complete' WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, tags)
    VALUES (${articleId}, 1, 'rule', 'pass', 'management', ${title}, ${summary}, 90, true, ARRAY['因果推断'])`;
  await publishArticle(articleId, { releasedAt: at });
  return articleId;
}

const hrefs = (mentions: Array<{ href: string | null }>) => mentions.map((m) => m.href);
const title = "因果推断与双重差分方法研究";
const summary = "论文使用双重差分估计政策影响，并报告稳健性检验。";

test("an article page is sent only the extra pages its summary names", async () => {
  const id = await article(title, summary);
  installModules([]);
  const bare = await loadItemDetail(id);
  assert.equal(bare.kind, "found");
  if (bare.kind !== "found") return;
  assert.deepEqual(hrefs(bare.item.mentions), [], "tag chips are separate; a site without modules has no extra pages");

  installModules(methods);
  const full = await loadItemDetail(id);
  if (full.kind !== "found") return assert.fail("article missing");
  assert.deepEqual(full.item.mentions, [
    { href: "/methods/did", names: ["双重差分"] },
  ]);
});

test("an event page is sent the pages its overview names", async () => {
  installModules(methods);
  const id = await article(title, summary);
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${randomUUID()}, '政策效果研究', ${at}, ${at}) RETURNING id`;
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title, subject, action, object) VALUES (${`f-${randomUUID()}`}, ${s!.id}, '政策效果研究', '研究团队', '评估', '政策效果') RETURNING id`;
  await sql`INSERT INTO fact_articles (fact_id, article_id, role, evidence) VALUES (${f!.id}, ${id}, 'report', 'fixture')`;
  await sql`UPDATE publications SET story_id = ${s!.id}, fact_id = ${f!.id} WHERE article_id = ${id}`;
  const story = await loadStoryDetail(Number(s!.id), new Date(+at + 3600_000));
  assert.ok(story);
  assert.equal(story.excerpt?.text, summary);
  assert.deepEqual(hrefs(story.mentions), ["/methods/did"]);
});

test("a report is sent the pages its lead and summaries name", async () => {
  installModules(methods);
  const id = await article(title, summary);
  const key = "2096-02-01";
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
    VALUES ('daily', ${key}, ${at}, ${at}, ${sql.json({
      lead: { title, leadParagraph: summary },
      sections: [{ label: "经济学", items: [{ itemId: id, title, summary, sourceUrl: "https://example.com", sourceName: "Mention source" }] }],
    } as never)}, ${at})`;
  const report = (await loadReport("daily", key))!;
  assert.deepEqual(hrefs(report.mentions), ["/methods/did"]);
});
