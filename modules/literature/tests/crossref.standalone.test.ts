// Crossref records as the site stores them: which date is the publication day, what is not a paper, and
// the window a run reads. No database: a query here fails on purpose.
import assert from "node:assert/strict";
import { test } from "node:test";
import { abstractText, authorLine, crossrefUserAgent, depositsQuery, hasMoreDeposits, isFrontMatter, issnBatches, publicationDay, toPaper, type CrossrefWork } from "../backend/crossref.ts";
import { collectionWindow, shiftDay } from "../backend/window.ts";

const NOW = new Date("2026-11-24T04:00:00Z");

function work(fields: Partial<CrossrefWork> = {}): CrossrefWork {
  return { DOI: "10.1000/xyz123", title: ["A paper title"], created: { "date-time": "2026-11-20T10:00:00Z" }, ...fields };
}

test("the online publication day comes first, to the day", () => {
  const day = publicationDay(work({ "published-online": { "date-parts": [[2026, 11, 19]] }, published: { "date-parts": [[2026, 12]] } }))!;
  assert.equal(day.dateBasis, "online");
  assert.equal(day.publicationTime, "2026-11-19");
  assert.equal(day.publishedAt.toISOString(), "2026-11-19T00:00:00.000Z");
  assert.equal(day.depositLagDays, 1);
});

test("a date ahead of the deposit (an issue cover date) gives way to the deposit day", () => {
  const day = publicationDay(work({ published: { "date-parts": [[2027, 1, 15]] } }))!;
  assert.equal(day.dateBasis, "created");
  assert.equal(day.publicationTime, "2026-11-20");
  assert.equal(day.depositLagDays, 0);
});

test("publication dates share ingestion's one-hour future tolerance with the deposit", () => {
  const fields = { published: { "date-parts": [[2026, 11, 21]] } };
  const within = publicationDay(work({ ...fields, created: { "date-time": "2026-11-20T23:00:00Z" } }))!;
  assert.equal(within.dateBasis, "published", "exactly one hour ahead is usable");
  const outside = publicationDay(work({ ...fields, created: { "date-time": "2026-11-20T22:59:59Z" } }))!;
  assert.equal(outside.dateBasis, "created", "more than one hour ahead falls back to the deposit day");
  assert.equal(outside.publicationTime, "2026-11-20");
});

test("partial dates (month-only or year-only) and publisher deposit lags past 48h fall back to deposit day", () => {
  const monthOnly = publicationDay(work({ published: { "date-parts": [[2026, 11]] } }))!;
  assert.equal(monthOnly.dateBasis, "created");
  assert.equal(monthOnly.publicationTime, "2026-11-20");

  const yearOnly = publicationDay(work({ "published-online": { "date-parts": [[2026]] } }))!;
  assert.equal(yearOnly.dateBasis, "created");
  assert.equal(yearOnly.publicationTime, "2026-11-20");

  const lagged = publicationDay(work({ "published-online": { "date-parts": [[2026, 11, 10]] } }))!;
  assert.equal(lagged.dateBasis, "created");
  assert.equal(lagged.publicationTime, "2026-11-20");
  assert.equal(lagged.depositLagDays, 0);
});

test("Crossref User-Agent includes mailto for the polite pool when configured", () => {
  assert.match(crossrefUserAgent("team@example.edu"), /mailto:team@example\.edu\)$/);
  assert.doesNotMatch(crossrefUserAgent(""), /mailto:/);
});

test("a record without any date is not stored", () => {
  assert.equal(publicationDay({ DOI: "10.1/x" }), null);
  assert.equal(toPaper({ DOI: "10.1/x", title: ["No date"] }, NOW), null);
});

test("errata and front matter are not papers", () => {
  for (const title of ["Erratum to: Market design", "Corrigendum", "Editorial Board", "In This Issue", "Retraction Notice: Fraud", "Acknowledgement of Reviewers", "Editorial: The role of marketing", "Correction to: Agency costs", "Corrections to: Agency costs", "Contents", "Author Index", "Correction", "Book Review: Everyday erotics by Tang", "Book reviews in brief", "Books received"]) {
    assert.equal(isFrontMatter(title), true, title);
    assert.equal(toPaper(work({ title: [title] }), NOW), null, title);
  }
  for (const title of ["Corrections and market response", "Index fund flows and prices", "Contents and consequences of contract terms", "Correcting for selection in panel data", "Retractions and research integrity"]) {
    assert.equal(isFrontMatter(title), false, title);
  }
});

test("the paper draft: DOI link, authors, abstract as text", () => {
  const paper = toPaper(work({
    DOI: "10.1111/JOMS.70178",
    title: ["  Innovation   and performance "],
    abstract: "<jats:title>Abstract</jats:title><jats:p>We study <i>firms</i> &amp; find that markets respond strongly to the treatment across all specifications.</jats:p>",
    author: [{ given: "Ada", family: "Lovelace" }, { family: "Turing", given: "Alan" }, { name: "Grace Hopper" }, { given: "Edsger", family: "Dijkstra" }],
  }), NOW)!;
  assert.equal(paper.doi, "10.1111/joms.70178");
  assert.equal(paper.url, "https://doi.org/10.1111/joms.70178");
  assert.equal(paper.title, "Innovation and performance");
  assert.equal(paper.author, "Ada Lovelace, Alan Turing, Grace Hopper et al.");
  assert.equal(paper.abstract, "We study firms & find that markets respond strongly to the treatment across all specifications.");
  assert.equal(publicationDay(work())!.dateBasis, "created");
});

test("a stub abstract or none at all is left empty", () => {
  assert.equal(abstractText(undefined), null);
  assert.equal(abstractText("<jats:p>Abstract</jats:p>"), null);
  assert.equal(authorLine({ DOI: "x" }), null);
});

test("a work published after today is not stored", () => {
  assert.equal(toPaper(work({ created: { "date-time": "2027-01-01T00:00:00Z" } }), NOW), null);
});

test("the window: an overlap behind the cursor, bounded after a pause", () => {
  assert.equal(shiftDay("2026-11-24", -3), "2026-11-21");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.deepEqual(collectionWindow(null, "2026-11-24"), { from: "2026-11-21", until: "2026-11-24" });
  assert.deepEqual(collectionWindow("2026-11-23", "2026-11-24"), { from: "2026-11-20", until: "2026-11-24" });
  assert.deepEqual(collectionWindow("2026-10-01", "2026-11-24"), { from: "2026-11-03", until: "2026-11-24" });
  assert.deepEqual(collectionWindow("2026-11-30", "2026-11-24"), { from: "2026-11-24", until: "2026-11-24" });
});

test("ISSNs go to Crossref in fixed-size groups", () => {
  const issns = Array.from({ length: 61 }, (_, i) => String(i));
  const batches = issnBatches(issns);
  assert.deepEqual(batches.map((b) => b.length), [25, 25, 11]);
  assert.deepEqual(issnBatches([]), []);
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
});

test("a full final page ends when Crossref's total has been reached", () => {
  const fullPage = Array.from({ length: 1000 }, () => work());
  assert.equal(hasMoreDeposits(fullPage, 6000, 6000), false);
  assert.equal(hasMoreDeposits(fullPage, 6001, 6000), true);
  assert.equal(hasMoreDeposits(fullPage, undefined, 6000), true, "without a total, a full page is ambiguous");
  assert.equal(hasMoreDeposits(fullPage.slice(1), 6000, 5999), false);
});

test("every ISSN is its own Crossref pair (several in one pair are refused)", () => {
  const query = depositsQuery(["0165-4101", "0361-3682"], "2026-11-21", "2026-11-24", 1);
  assert.equal(query.get("filter"), "issn:0165-4101,issn:0361-3682,type:journal-article,from-created-date:2026-11-21,until-created-date:2026-11-24");
  assert.equal(query.get("rows"), "1000");
  assert.equal(query.get("offset"), "1000");
  assert.match(query.get("select")!, /^DOI,title,/);
});
