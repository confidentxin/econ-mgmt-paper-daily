// The literature module's backend: the Crossref collection, as a worker schedule behind the collection valve.
import { defineServerModule } from "@aihot/backend/modules";
import { collectCrossref } from "./backend/collect.ts";

export const literature = defineServerModule({
  name: "literature",
  schedules: [
    // Every three hours; a run missed while the worker was away runs once when it is back.
    { name: "literature.crossref", cron: "40 */3 * * *", missed: "once", run: () => collectCrossref(), when: () => process.env.COLLECT_ENABLED === "true" },
  ],
});
