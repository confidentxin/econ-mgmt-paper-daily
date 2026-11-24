// A withdrawn paper leaves tag-topic pages at once, though the topic index behind them is kept for a
// minute. Corrections must also refresh the cached headline and move tag membership before cache expiry.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { listTopicSummaries, loadTopicPage } from "@aihot/backend/publication/topics";
import { overrideFields } from "@aihot/backend/admin/content";

const T = tag();
const SOURCE = `test-topics-withdrawal-${T}`;
let older: string;
let newer: string;
let corrected: string;

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${SOURCE}, 'Journal', 'external', 'T1_5', 'editorial', '2100-01-01')`;
  older = await report(1, 3, "实证研究");
  newer = await report(2, 1, "实证研究");
  corrected = await report(3, 2, "因果推断");
  // All scenarios share this one cold index, then exercise the cache without waiting a minute.
  await loadTopicPage("empirical", 1);
  await loadTopicPage("causal-inference", 1);
});
after(async () => {
  await stopBoss();
  await closeDb();
});

async function report(n: number, hoursAgo: number, tagName: string): Promise<string> {
  const at = new Date(Date.now() - hoursAgo * 3600_000);
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/withdrawal-${T}-${n}`, title: `${tagName}论文 ${n}`,
    bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: at,
  });
  await sql`UPDATE articles SET discovered_at = ${at}, timeline_at = ${at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', 'economics', ${`${tagName}论文 ${n}`}, '摘要', 80, true, ${[]}, ${[tagName]})`;
  await publishArticle(articleId, { releasedAt: new Date(at.getTime() + 60_000) });
  return articleId;
}

test("a withdrawn paper leaves the topic page and the index while the topic index is still cached", async () => {
  const before = await loadTopicPage("empirical", 1);
  assert.ok(before?.items.some((i) => i.id === newer));
  assert.equal((await listTopicSummaries()).topics.find((t) => t.slug === "empirical")?.latest?.title, "实证研究论文 2");

  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${newer}`;
  const page = await loadTopicPage("empirical", 1);
  assert.equal(page?.topic.latest?.title, "实证研究论文 1", "the page's last update");
  assert.equal((await listTopicSummaries()).topics.find((t) => t.slug === "empirical")?.latest?.title, "实证研究论文 1", "the index page's headline");
  assert.deepEqual(page?.items.map((i) => i.id), [older], "the list checks rows again");
});

test("a correction refreshes named content and its topic membership before the index expires", async () => {
  const title = `更正后的因果推断论文 ${T}`;
  await overrideFields(corrected, { fields: { title }, version: 0, reason: "更正标题" }, "test-topics");
  const retitled = await loadTopicPage("causal-inference", 1);
  assert.equal(retitled?.items[0]?.title, title, "the list");
  assert.equal(retitled?.topic.latest?.title, title, "the page headline");
  assert.equal((await listTopicSummaries()).topics.find((t) => t.slug === "causal-inference")?.latest?.title, title, "the directory headline");

  await overrideFields(corrected, { fields: { category: "accounting" }, version: 1, reason: "更正研究领域" }, "test-topics");
  const reclassified = await loadTopicPage("causal-inference", 1);
  assert.equal(reclassified?.items[0]?.id, corrected, "it remains a selected paper");

  await overrideFields(corrected, { fields: { tags: ["综述与评论"] }, version: 2, reason: "更正论文类型" }, "test-topics");
  const moved = await loadTopicPage("causal-inference", 1);
  assert.deepEqual(moved?.items, [], "the old topic list drops it");
  assert.equal(moved?.topic.latest, null, "the old topic headline drops it");
  assert.equal((await listTopicSummaries()).topics.find((t) => t.slug === "causal-inference")?.latest, null, "the directory drops the old membership");
  assert.equal((await loadTopicPage("review", 1, new Date()))?.items[0]?.id, corrected, "the corrected membership is retained");
});
