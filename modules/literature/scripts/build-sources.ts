// Writes industry/sources.json from the journal registry (../data/journals.json): one external source per
// journal, so a paper's source is the journal that published it and the back office can pause one journal.
// Run after the registry or tier mapping changes: node modules/literature/scripts/build-sources.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyJournal } from "../backend/tiers.ts";

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

const sources = journals.map((j) => {
  const { tier, selectionClass, absTag } = classifyJournal(j);
  const tags = ["期刊", ...j.lists, ...(absTag ? [absTag] : []), ...(selectionClass === "adjacent" ? ["相邻学科"] : [])];
  return {
    id: j.sourceId,
    name: j.name,
    kind: "external",
    config: {},
    tier,
    ...(selectionClass ? { selection_class: selectionClass } : {}),
    participation_mode: "editorial",
    // Read by the literature module's schedule, not by the engine's collectors.
    interval_minutes: 1440,
    tags: [...new Set(tags)],
    site_fulltext: false,
    syndicate_fulltext: false,
    enabled: true,
  };
});

const file = {
  $comment: "经管期刊，每本期刊一个信源（由 modules/literature/scripts/build-sources.ts 按 modules/literature/data/journals.json 与 backend/tiers.ts 生成，不要手改）。首次启动时导入（scripts/seed.ts）；已有数据库可运行 node --env-file=.env modules/literature/scripts/sync-sources.ts 同步分级与类别。分级：UTD24/FT50/ABS 4* 为 T1，ABS 4 星为 T1_5，核心 ABS 3 星附 selection_class=abs3，相邻学科附 selection_class=adjacent。",
  sources,
};
writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
console.log(`wrote ${sources.length} journal sources to ${path.relative(process.cwd(), target)}`);
