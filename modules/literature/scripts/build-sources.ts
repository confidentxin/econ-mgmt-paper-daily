// Writes industry/sources.json from the journal registry (../data/journals.json): one external source per
// journal, so a paper's source is the journal that published it and the back office can pause one journal.
// Run after the registry changes: node modules/literature/scripts/build-sources.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface RegistryJournal {
  sourceId: string;
  name: string;
  issns: string[];
  lists: string[];
  crossref: boolean;
  openalexId: string | null;
}

const registry = path.join(import.meta.dirname, "../data/journals.json");
const target = path.join(import.meta.dirname, "../../../industry/sources.json");
const { journals } = JSON.parse(readFileSync(registry, "utf8")) as { journals: RegistryJournal[] };

/** Provisional, until the selection thresholds are recalibrated for papers: the two top lists as first-hand, the rest one step down. */
const tier = (lists: string[]) => (lists.includes("UTD24") || lists.includes("FT50") ? "T1" : "T1_5");

const sources = journals.map((j) => ({
  id: j.sourceId,
  name: j.name,
  kind: "external",
  config: {},
  tier: tier(j.lists),
  participation_mode: "editorial",
  // Read by the literature module's schedule, not by the engine's collectors.
  interval_minutes: 1440,
  tags: ["期刊", ...j.lists],
  site_fulltext: false,
  syndicate_fulltext: false,
  enabled: true,
}));

const file = {
  $comment: "经管期刊，每本期刊一个信源（由 modules/literature/scripts/build-sources.ts 按 modules/literature/data/journals.json 生成，不要手改；改期刊范围请改那份数据再重新生成）。首次启动时导入（scripts/seed.ts），已存在的不会被覆盖。分级暂定：UTD24/FT50 为 T1，其余为 T1_5。",
  sources,
};
writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
console.log(`wrote ${sources.length} journal sources to ${path.relative(process.cwd(), target)}`);
