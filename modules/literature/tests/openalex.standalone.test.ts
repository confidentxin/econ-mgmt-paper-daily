import assert from "node:assert/strict";
import { test } from "node:test";
import { doiBatches, normalizeDoi, openalexUserAgent, openalexWorksQuery, reconstructAbstract } from "../backend/openalex.ts";

test("normalizeDoi strips doi.org prefixes and lowercases valid DOIs", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1016/J.JFINECO.2026.103999"), "10.1016/j.jfineco.2026.103999");
  assert.equal(normalizeDoi("http://dx.doi.org/10.1257/AER.20240001 "), "10.1257/aer.20240001");
  assert.equal(normalizeDoi("10.1093/qje/qjae001"), "10.1093/qje/qjae001");
  assert.equal(normalizeDoi(""), null);
  assert.equal(normalizeDoi("not-a-doi"), null);
});

test("reconstructAbstract rebuilds OpenAlex inverted indexes and strips leading Abstract labels", () => {
  const inverted = {
    "Abstract:": [0],
    We: [1, 9],
    estimate: [2],
    the: [3, 6],
    effect: [4],
    of: [5],
    policy: [7],
    and: [8],
    find: [10],
    substantial: [11],
    productivity: [12],
    gains: [13],
    across: [14],
    firms: [15],
  };
  assert.equal(
    reconstructAbstract(inverted),
    "We estimate the effect of the policy and We find substantial productivity gains across firms",
  );
  assert.equal(reconstructAbstract(null), null);
  assert.equal(reconstructAbstract({ Short: [0], text: [1] }), null, "abstracts under 40 chars are rejected");
});

test("doiBatches deduplicates normalized DOIs and chunks by 50", () => {
  const dois = [
    "https://doi.org/10.1016/J.A.1",
    "10.1016/j.a.1",
    ...Array.from({ length: 55 }, (_, i) => `10.1000/test.${i}`),
  ];
  const batches = doiBatches(dois);
  assert.deepEqual(batches.map((b) => b.length), [50, 6]);
});

test("openalexWorksQuery builds pipe-separated DOI filter and optional polite-pool params", () => {
  const q = openalexWorksQuery(["10.1016/j.jfineco.1", "10.1016/j.jme.2"], { mailto: "lab@example.edu", apiKey: "oa-key" });
  assert.equal(q.get("filter"), "doi:https://doi.org/10.1016/j.jfineco.1|https://doi.org/10.1016/j.jme.2");
  assert.equal(q.get("per-page"), "2");
  assert.equal(q.get("mailto"), "lab@example.edu");
  assert.equal(q.get("api_key"), "oa-key");
  assert.match(openalexUserAgent("lab@example.edu"), /mailto:lab@example\.edu\)$/);
});
