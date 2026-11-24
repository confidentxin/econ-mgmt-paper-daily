// Classification corrections must move frozen daily/weekly/monthly columns atomically without selecting,
// rewriting, notifying, or leaving an obsolete section introduction behind.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { overrideFields } from "@aihot/backend/admin/content";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { dailyMetrics } from "@aihot/backend/reports/compose";
import type { EditionEntry } from "@aihot/backend/reports/edition";
import { QUEUES, getBoss, stopBoss } from "@aihot/backend/jobs/queue";

after(async () => { await stopBoss(); await closeDb(); });

test("a literature pack with no headline release kind reports only its ordinary metrics", () => {
  const base = { category: "economics", tags: ["实证研究"], authority: 0, previous: null,
    entry: { sourceId: "journal", firstParty: true } } as EditionEntry;
  const rows = [base, { ...base, tags: ["因果推断"] }, { ...base, category: "finance" },
    { ...base, authority: 3 }, { ...base, previous: { key: "2026-09-30", title: "已收录" } }, { ...base, tags: [] }];
  assert.deepEqual(dailyMetrics(rows), { totalEvents: 6, sourcesCount: 1, firstPartyEvents: 6 });
});

test("category corrections revise every standard report atomically without selecting, rewriting or notifying", async () => {
  await getBoss(); // the digest check below reads the job table
  const sourceId = `category-${tag()}`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode) VALUES (${sourceId},'Journal','external','T1','editorial')`;
  const { articleId } = await upsertMaterial({ sourceId, url: `https://example.com/${sourceId}`, title: "公司治理研究", bodyText: "论文正文", bodyStatus: "ok", via: "fetch", publishedAt: new Date(Date.now() - 60_000) });
  await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,score,selected)
    VALUES (${articleId},1,'rule','pass','economics',ARRAY['实证研究','公司治理'],'公司治理研究','冻结摘要',88,true)`;
  const [story] = await sql`INSERT INTO stories (public_id,title) VALUES (gen_random_uuid(),'论文发表') RETURNING id`;
  const [fact] = await sql`INSERT INTO facts (public_id,title,story_id) VALUES (${`f-${tag()}`},'发表论文',${story!.id}) RETURNING id`;
  await sql`INSERT INTO fact_articles (fact_id,article_id,role) VALUES (${fact!.id},${articleId},'report')`;
  await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60_000) });
  const entry = { itemId: articleId, title: "冻结标题", summary: "冻结摘要", sourceId, firstParty: true, role: "官方" };
  const contents = [
    { kind: "daily", key: "2097-01-02", content: { leadItemId: articleId, lead: { title: "冻结头条" }, highlights: [articleId], flashes: [], sections: [{ label: "经济学", items: [entry] }], metrics: { totalEvents: 1 } } },
    ...(["weekly", "monthly"] as const).map(kind => ({ kind, key: kind === "weekly" ? "2097-W01" : "2097-01", content: { headline: "冻结头条", leadItemId: articleId, storyOrder: [articleId], overview: "保留总述", themes: [{ heading: "经济学", summary: "旧经济学导读", storyRefs: [entry] }], metrics: { totalStories: 1 } } })),
  ];
  for (const r of contents) await sql`INSERT INTO reports (kind,key,window_start,window_end,content,generated_at)
    VALUES (${r.kind},${r.key},now(),now(),${sql.json(r.content as never)},now())`;
  const [before] = await sql`SELECT selected,seat,score,visible_after,selected_ready_at FROM publications WHERE article_id=${articleId}`;
  const change = (actor: string) => overrideFields(articleId, { fields: { category: "finance", tags: ["实证研究", "公司金融"] }, version: 0, reason: "更正研究领域" }, actor);
  await sql.unsafe(`CREATE FUNCTION reject_category_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.actor = 'reject-category' THEN RAISE EXCEPTION 'category audit rejected'; END IF; RETURN NEW; END $$`);
  await sql.unsafe("CREATE TRIGGER reject_category_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_category_audit()");
  try {
    await assert.rejects(change("reject-category"), /category audit rejected/);
    assert.equal((await sql`SELECT category FROM publications WHERE article_id=${articleId}`)[0]!.category, "economics");
    assert.equal((await sql`SELECT 1 FROM report_revisions WHERE report_id IN (SELECT id FROM reports WHERE key IN ('2097-01-02','2097-W01','2097-01'))`).length, 0);
  } finally {
    await sql.unsafe("DROP TRIGGER reject_category_audit ON audit_log; DROP FUNCTION reject_category_audit()");
  }
  const digestCount = (await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name=${QUEUES.digest}`)[0]!.n;
  await change("test-category");
  for (const r of contents) {
    const [saved] = await sql`SELECT content,revision FROM reports WHERE kind=${r.kind} AND key=${r.key}`;
    assert.equal(saved!.revision, 2);
    const c = saved!.content;
    assert.equal(c.leadItemId, articleId);
    if (r.kind === "daily") {
      assert.deepEqual(c.sections, [{ key: "finance", label: "金融", items: [entry] }]);
      assert.deepEqual(c.metrics, { totalEvents: 1 });
      assert.deepEqual(c.highlights, [articleId]);
      assert.equal(c.lead.title, "冻结头条");
    } else {
      assert.deepEqual(c.themes, [{ key: "finance", heading: "金融", summary: null, storyRefs: [entry] }]);
      assert.deepEqual(c.storyOrder, [articleId]);
      assert.equal(c.overview, "保留总述");
    }
  }
  assert.deepEqual((await sql`SELECT selected,seat,score,visible_after,selected_ready_at FROM publications WHERE article_id=${articleId}`)[0], before);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name=${QUEUES.digest}`)[0]!.n, digestCount);
  await overrideFields(articleId, { fields: {}, clear: ["category", "tags"], version: 1, reason: "验证撤销纠错" }, "test-category");
  const [restored] = await sql`SELECT content FROM reports WHERE kind='daily' AND key='2097-01-02'`;
  assert.equal(restored!.content.sections[0].label, "经济学");
  assert.deepEqual(restored!.content.metrics, { totalEvents: 1 });
});

test("a correction keeps the introduction of the section it moves into", async () => {
  const sourceId = `category-intro-${tag()}`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode) VALUES (${sourceId},'Journal','external','T1_5','editorial')`;
  const { articleId } = await upsertMaterial({ sourceId, url: `https://example.com/${sourceId}`, title: "公司金融研究", bodyText: "正文", bodyStatus: "ok", via: "fetch", publishedAt: new Date(Date.now() - 60_000) });
  await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,score,selected)
    VALUES (${articleId},1,'rule','pass','economics',ARRAY['实证研究'],'公司金融研究','论文摘要',70,true)`;
  await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60_000) });
  const moved = { itemId: articleId, title: "公司金融研究", summary: "论文摘要" };
  const other = (n: number, title: string) => ({ itemId: `${articleId}-${n}`, title, summary: `${title}摘要` });
  const themes = [
    { heading: "经济学", summary: "本周经济学导读", storyRefs: [moved, other(1, "论文甲"), other(2, "论文乙"), other(3, "论文丙")] },
    { heading: "金融", summary: "本周金融导读", storyRefs: [other(4, "金融论文甲"), other(5, "金融论文乙"), other(6, "金融论文丙")] },
  ];
  await sql`INSERT INTO reports (kind,key,window_start,window_end,content,generated_at)
    VALUES ('weekly','2097-W02',now(),now(),${sql.json({ headline: "冻结头条", leadItemId: articleId, storyOrder: [articleId], overview: "保留总述", themes, metrics: { totalStories: 7 } } as never)},now())`;
  await overrideFields(articleId, { fields: { category: "finance" }, version: 0, reason: "更正研究领域" }, "test-category");
  const [saved] = await sql`SELECT content FROM reports WHERE kind='weekly' AND key='2097-W02'`;
  const intros = Object.fromEntries((saved!.content.themes as Array<{ heading: string; summary: string | null }>).map(g => [g.heading, g.summary]));
  assert.deepEqual(intros, { 经济学: null, 金融: "本周金融导读" });
});
