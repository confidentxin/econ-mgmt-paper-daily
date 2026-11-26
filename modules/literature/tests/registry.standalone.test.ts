import assert from "node:assert/strict";
import { test } from "node:test";
import { crossrefIssns, journalByIssn, journals, paperBodyStatus, validIssn } from "../backend/registry.ts";

test("ISSN validation accepts check digits, including X, and rejects malformed values", () => {
  for (const issn of ["0378-5955", "2049-3630", "0000-0000"]) assert.equal(validIssn(issn), true, issn);
  for (const issn of ["0378-5956", "1540-8520", "0447-2778", "1526-5489", "123", "abcdefg"]) assert.equal(validIssn(issn), false, issn);
});

test("the shipped journal registry has unique identities and valid, globally unique ISSNs", () => {
  const all = journals();
  assert.equal(all.length, 452);
  const names = all.map((j) => j.name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, ""));
  const ids = all.map((j) => j.sourceId);
  const issns = all.flatMap((j) => j.issns);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(issns.length, 899);
  assert.equal(new Set(issns).size, issns.length);
  assert.ok(issns.every(validIssn));
});

test("Crossref ISSNs are valid and unique, and lookup accepts common ISSN formatting", () => {
  const issns = crossrefIssns();
  assert.ok(issns.length > 0);
  assert.equal(new Set(issns).size, issns.length);
  assert.ok(issns.every(validIssn));
  const journal = journals()[0]!;
  assert.equal(journalByIssn([journal.issns[0]!.toLowerCase()])?.sourceId, journal.sourceId);
  assert.equal(journalByIssn([` ${journal.issns[0]} `])?.sourceId, journal.sourceId);
  assert.equal(journalByIssn([undefined, "0000-0000"]), null);
  const withoutFirst = crossrefIssns(new Set([journal.sourceId]));
  for (const issn of journal.issns) assert.equal(withoutFirst.includes(issn.toUpperCase()), false);
});

test("papers with an abstract skip webpage body extraction while title-only records stay pending", () => {
  assert.equal(paperBodyStatus("We estimate the causal effect of minimum wages on employment."), "none");
  assert.equal(paperBodyStatus(null), "pending");
  assert.equal(paperBodyStatus(undefined), "pending");
  assert.equal(paperBodyStatus(""), "pending");
});
