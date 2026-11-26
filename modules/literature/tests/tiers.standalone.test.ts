import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { SELECTION } from "@aihot/industry/selection";
import { journals } from "../backend/registry.ts";
import { ABS_4_SOURCE_IDS, ABS_4_STAR_SOURCE_IDS, ADJACENT_SOURCE_IDS, classifyJournal } from "../backend/tiers.ts";

test("every curated ABS 4*, ABS 4 and adjacent sourceId exists in journals.json without overlap between 4* and 4", () => {
  const allIds = new Set(journals().map((j) => j.sourceId));
  for (const id of ABS_4_STAR_SOURCE_IDS) assert.ok(allIds.has(id), `unknown ABS 4* sourceId: ${id}`);
  for (const id of ABS_4_SOURCE_IDS) {
    assert.ok(allIds.has(id), `unknown ABS 4 sourceId: ${id}`);
    assert.ok(!ABS_4_STAR_SOURCE_IDS.has(id), `duplicate in ABS 4* and ABS 4: ${id}`);
  }
  for (const id of ADJACENT_SOURCE_IDS) assert.ok(allIds.has(id), `unknown adjacent sourceId: ${id}`);
});

test("classifyJournal promotes ABS 4* to T1, separates ABS 4 from ABS 3, and raises adjacent journals", () => {
  assert.deepEqual(
    classifyJournal({ sourceId: "journal-the-review-of-economics-and-statistics", lists: ["ABS"] }),
    { tier: "T1", selectionClass: null, absTag: "ABS 4*" },
  );
  assert.deepEqual(
    classifyJournal({ sourceId: "journal-american-economic-journal-applied-economics", lists: ["ABS"] }),
    { tier: "T1_5", selectionClass: null, absTag: "ABS 4" },
  );
  assert.deepEqual(
    classifyJournal({ sourceId: "journal-economics-letters", lists: ["ABS"] }),
    { tier: "T1_5", selectionClass: "abs3", absTag: "ABS 3" },
  );
  assert.deepEqual(
    classifyJournal({ sourceId: "journal-environmental-science-and-technology", lists: ["ABS"] }),
    { tier: "T1_5", selectionClass: "adjacent", absTag: "ABS 3" },
  );
});

test("industry/sources.json matches build-sources output and uses only registered SELECTION.classes", () => {
  const raw = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../../industry/sources.json"), "utf8")) as {
    sources: Array<{ id: string; tier: string; selection_class?: string }>;
  };
  assert.equal(raw.sources.length, journals().length);
  for (const s of raw.sources) {
    assert.ok(s.tier in SELECTION.thresholds, `unknown tier ${s.tier}`);
    if (s.selection_class) assert.ok(s.selection_class in SELECTION.classes, `unknown selection_class ${s.selection_class}`);
  }
});
