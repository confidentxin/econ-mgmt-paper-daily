// Tag topics: which papers each topic takes, how their tags link to topic pages, and the public counts.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { TOPICS, loadTopicPage, listTopicSummaries, topicsOfStory } from "@aihot/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const MEDIA = `test-topics-media-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES
    (${MEDIA}, 'Journal', 'external', 'T1_5', 'editorial', '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
interface Report {
  at: Date;
  title: string;
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** A published paper; `fact` links it to a story before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.title,
    bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${r.category ?? "economics"}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${[]}, ${r.tags ?? ["实证研究"]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

let initialEmpirical: string[] = [];
let initialEmpiricalLatest = "";
let articleTagsId = "";
let storyPaperId = "";
let keptEmpiricalId = "";

test("tag topics take papers carrying their own tag, not merely a related field", async () => {
  const empirical = await report({ at: hoursAgo(30), title: `面板数据研究 ${T}` });
  const both = await report({ at: hoursAgo(31), title: `双重差分研究 ${T}`, tags: ["实证研究", "因果推断"] });
  const causalOnly = await report({ at: hoursAgo(32), title: `识别方法研究 ${T}`, tags: ["因果推断"], category: "accounting" });
  const governance = await report({ at: hoursAgo(33), title: `公司治理研究 ${T}`, tags: ["公司治理"] });

  assert.deepEqual((await members("empirical")).sort(), [empirical, both].sort());
  initialEmpirical = [empirical, both];
  initialEmpiricalLatest = empirical;
  const initial = await page("empirical");
  assert.equal(initial.topic.poolTotal, 2);
  assert.equal(initial.topic.total, 2);
  assert.equal(initial.topic.latest?.id, initialEmpiricalLatest);
  assert.deepEqual((await members("causal-inference")).sort(), [both, causalOnly].sort());
  assert.ok(!(await members("empirical")).includes(governance), "a field topic alone does not imply a paper type");
  assert.ok((await members("governance")).includes(governance));
});

test("an article page says which of its tags are a topic's own", async () => {
  const id = await report({
    at: hoursAgo(3), title: `公司治理与因果推断 ${T}`,
    tags: ["实证研究", "因果推断", "机器学习", "公司治理", "自定义标签"],
  });
  articleTagsId = id;
  const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
  const body = JSON.parse(res.body) as { tags: string[]; tagTopics: Record<string, string>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.tags, ["实证研究", "因果推断", "机器学习", "公司治理", "自定义标签"]);
  assert.deepEqual(body.tagTopics, {
    实证研究: "empirical", 因果推断: "causal-inference", 机器学习: "machine-learning", 公司治理: "governance",
  });
  assert.deepEqual(body.topics.map((t) => t.slug).sort(), ["causal-inference", "empirical", "governance", "machine-learning"]);
});

test("a story page names the topics of its papers", async () => {
  const launch = await story(`公司治理研究 ${T}`);
  storyPaperId = await report({ at: hoursAgo(26), title: `公司治理研究 ${T}`, tags: ["实证研究", "公司治理"], fact: await fact(launch.id, "发表论文") });
  assert.deepEqual(await topicsOfStory(launch.id), [
    { slug: "empirical", name: "实证研究" }, { slug: "governance", name: "公司治理" },
  ]);
});

test("withdrawn articles stay out of lists and counts", async () => {
  keptEmpiricalId = await report({ at: hoursAgo(5), title: `保留的实证研究 ${T}` });
  const withdrawn = await report({ at: hoursAgo(4), title: `撤回的实证研究 ${T}` });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("empirical");
  assert.deepEqual(ids(data.items).sort(), [...initialEmpirical, articleTagsId, storyPaperId, keptEmpiricalId].sort());
  assert.equal(data.topic.poolTotal, 5, "withdrawn papers are excluded from the public pool count");
  assert.equal(data.topic.total, 5, "withdrawn papers are excluded from the selected count");
  assert.equal(data.topic.latest?.id, articleTagsId, "the newest visible paper remains latest");
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "empirical")!;
  assert.equal(summary.latest?.id, articleTagsId, "the index never shows a withdrawn paper as latest");
  assert.equal(summary.total, 5);
});

test("every topic has a page; unknown topics and pages past the end have none", async () => {
  const empty = await page("review");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("review", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["company", "field", "genre"]);
  assert.deepEqual(body.topics.map((t) => t.slug).sort(), TOPICS.map((t) => t.slug).sort(), "the index lists every topic");
});
