// The journal registry of the literature module (data/journals.json): which journals are followed, the
// lists that name them, their ISSNs, and the source each one is (industry/sources.json, written by
// scripts/build-sources.ts from this file). Shared by the collector and by the tests.
import { readFileSync } from "node:fs";
import path from "node:path";

export interface Journal {
  /** The source's id: one source per journal, so a paper's source is the journal that published it. */
  sourceId: string;
  name: string;
  issns: string[];
  /** The lists that name the journal: UTD24, FT50, ABS (3 and 4 star; the search query does not tell them apart). */
  lists: string[];
  /** Whether Crossref answers works for its ISSNs; the others are left to a later collector. */
  crossref: boolean;
  openalexId: string | null;
}

let cached: Journal[] | null = null;

const normalizeName = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");

/** ISBN-style check digit, also used by ISSNs after folding the X to 10. */
export function validIssn(issn: string): boolean {
  const value = issn.toUpperCase().replace(/[\s-]/gu, "");
  if (!/^\d{7}[\dX]$/u.test(value)) return false;
  const sum = [...value.slice(0, 7)].reduce((total, digit, i) => total + Number(digit) * (8 - i), 0);
  const check = (11 - sum % 11) % 11;
  return (check === 10 ? "X" : String(check)) === value[7];
}

export function journals(): readonly Journal[] {
  if (cached) return cached;
  const text = readFileSync(path.join(import.meta.dirname, "../data/journals.json"), "utf8");
  const parsed = JSON.parse(text) as { journals: Journal[] };
  const ids = new Set<string>();
  const names = new Map<string, string>();
  const issns = new Map<string, string>();
  for (const j of parsed.journals) {
    if (!j.sourceId || !j.name || !j.issns.length) throw new Error(`journals.json: ${j.name ?? j.sourceId} has no id, name or ISSN`);
    if (ids.has(j.sourceId)) throw new Error(`journals.json: two journals share the source id ${j.sourceId}`);
    ids.add(j.sourceId);
    const nameKey = normalizeName(j.name);
    const named = names.get(nameKey);
    if (named) throw new Error(`journals.json: duplicate journal name "${j.name}" (${named}, ${j.sourceId})`);
    names.set(nameKey, j.sourceId);
    const own = new Set<string>();
    for (const raw of j.issns) {
      const issn = raw.toUpperCase().replace(/[\s-]/gu, "");
      if (!validIssn(raw)) throw new Error(`journals.json: ${j.sourceId} has invalid ISSN ${raw}`);
      if (own.has(issn)) throw new Error(`journals.json: ${j.sourceId} repeats ISSN ${raw}`);
      own.add(issn);
      const owner = issns.get(issn);
      if (owner) throw new Error(`journals.json: ISSN ${raw} belongs to both ${owner} and ${j.sourceId}`);
      issns.set(issn, j.sourceId);
    }
  }
  cached = parsed.journals;
  return cached;
}

/** The journal a Crossref work belongs to, by any of the ISSNs it names. */
export function journalByIssn(issns: readonly (string | undefined)[]): Journal | null {
  const wanted = new Set(issns.filter((v): v is string => !!v).map((v) => v.toUpperCase().replace(/[\s-]/gu, "")));
  if (!wanted.size) return null;
  return journals().find((j) => j.issns.some((issn) => wanted.has(issn.toUpperCase().replace(/[\s-]/gu, "")))) ?? null;
}

/** The journals read through Crossref, their ISSNs. */
export function crossrefIssns(): string[] {
  return [...new Set(journals().filter((j) => j.crossref).flatMap((j) => j.issns).map((issn) => issn.toUpperCase()))];
}
