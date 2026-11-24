// Crossref: the works deposited for a set of journal ISSNs between two deposit dates, as plain records.
// Nothing here reads or writes the database, so the rules are tested on their own (../tests/crossref.test.ts).
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { collapseWhitespace, decodeEntities, stripTags } from "@aihot/backend/lib/text";

export const CROSSREF_WORKS = "https://api.crossref.org/works";
/** Crossref gives a journal's works by any ISSN deposited on them; a request may name this many. */
export const ISSNS_PER_REQUEST = 25;
const PAGE_SIZE = 1000;
const MAX_PAGES = 6;
const RETRIES = 4;
const USER_AGENT = "econ-literature-site/0.1 (daily literature digest; https://github.com/confidentxin/econ-mgmt-paper-daily)";

export interface CrossrefDate {
  "date-parts"?: number[][];
  "date-time"?: string;
}

export interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
  sequence?: string;
}

/** The fields the collector asks Crossref for (its `select`). */
export interface CrossrefWork {
  DOI: string;
  title?: string[];
  ISSN?: string[];
  type?: string;
  created?: CrossrefDate;
  published?: CrossrefDate;
  "published-online"?: CrossrefDate;
  "published-print"?: CrossrefDate;
  abstract?: string;
  author?: CrossrefAuthor[];
}

/** A work ready to be stored: the article's title, author line, abstract and publication day. */
export interface PaperDraft {
  doi: string;
  url: string;
  title: string;
  author: string | null;
  abstract: string | null;
  /** The publication time as the site stores it: the day, when that is all Crossref knows. */
  publishedAt: Date;
  publicationTime: string;
  /** Which Crossref date was taken: published-online, published (the earliest of its dates) or created (the deposit). */
  dateBasis: "online" | "published" | "created";
  depositedAt: Date | null;
  /** Whole days between the publication day and the deposit: what the reader's "is it news" rule sees. */
  depositLagDays: number | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url: string): Promise<{ message?: { items?: CrossrefWork[]; "total-results"?: number } }> {
  for (let attempt = 1; ; attempt++) {
    let response: Awaited<ReturnType<typeof guardedFetch>>;
    try {
      response = await guardedFetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        timeoutMs: 60_000,
        maxBytes: 32 * 1024 * 1024,
      });
    } catch (error) {
      if (attempt >= RETRIES) throw error;
      await sleep(attempt * 3_000);
      continue;
    }
    if (response.status === 200) return JSON.parse(response.text()) as never;
    const wait = Number(response.headers.get("retry-after"));
    if ((response.status === 429 || response.status >= 500) && attempt < RETRIES) {
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 120) * 1_000 : attempt * 5_000);
      continue;
    }
    throw new Error(`Crossref answered ${response.status} for ${url.slice(0, 200)}`);
  }
}

export function depositsQuery(issns: readonly string[], from: string, until: string, page: number): URLSearchParams {
  const filter = `${issns.map((issn) => `issn:${issn}`).join(",")},type:journal-article,from-created-date:${from},until-created-date:${until}`;
  const select = "DOI,title,ISSN,type,created,published,published-online,published-print,abstract,author";
  return new URLSearchParams({ filter, select, rows: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
}

/** Whether a full Crossref page may have another page after it. */
export function hasMoreDeposits(items: readonly CrossrefWork[], totalResults: number | undefined, collected: number): boolean {
  if (items.length < PAGE_SIZE) return false;
  return typeof totalResults === "number" ? collected < totalResults : true;
}

/**
 * The works deposited for these ISSNs from `from` to `until` (deposit dates, inclusive, YYYY-MM-DD).
 * Requests go one at a time: Crossref's public pool answers a burst with 429.
 */
export async function fetchDeposits(issns: readonly string[], from: string, until: string): Promise<{ works: CrossrefWork[]; requests: number }> {
  if (!issns.length) return { works: [], requests: 0 };
  const works: CrossrefWork[] = [];
  let requests = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    requests += 1;
    const body = await getJson(`${CROSSREF_WORKS}?${depositsQuery(issns, from, until, page)}`);
    const items = body.message?.items ?? [];
    works.push(...items);
    if (!hasMoreDeposits(items, body.message?.["total-results"], works.length)) break;
    // Near Crossref's deep-paging limit; the caller reads a few days at a time, so this is a registry problem to fix.
    if (page === MAX_PAGES - 1) throw new Error(`Crossref returned more than ${MAX_PAGES * PAGE_SIZE} works for one ISSN batch from ${from}`);
  }
  return { works, requests };
}

function dateParts(date: CrossrefDate | undefined): Date | null {
  const parts = date?.["date-parts"]?.[0];
  if (!parts?.length || !parts[0]) return null;
  return new Date(Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1));
}

function depositTime(work: CrossrefWork): Date | null {
  const exact = work.created?.["date-time"] ? new Date(work.created["date-time"]) : null;
  if (exact && Number.isFinite(exact.getTime())) return exact;
  return dateParts(work.created);
}

/**
 * When the paper was published, to the day Crossref knows. The online date first, else the earliest of its
 * dates, else the deposit. A date that lies ahead of the deposit is an issue dated in the future (print
 * issues are deposited before their cover date), and the site would refuse it as not published yet: the
 * deposit time stands in for it.
 */
export function publicationDay(work: CrossrefWork): Pick<PaperDraft, "publishedAt" | "publicationTime" | "dateBasis" | "depositedAt" | "depositLagDays"> | null {
  const depositedAt = depositTime(work);
  if (!depositedAt) return null;
  const candidates: Array<[CrossrefDate | undefined, PaperDraft["dateBasis"]]> = [[work["published-online"], "online"], [work.published, "published"]];
  for (const [date, basis] of candidates) {
    const day = dateParts(date);
    if (day && day.getTime() <= depositedAt.getTime() + 3600_000) {
      return { publishedAt: day, publicationTime: day.toISOString().slice(0, 10), dateBasis: basis, depositedAt, depositLagDays: Math.floor((depositedAt.getTime() - day.getTime()) / 86_400_000) };
    }
  }
  const day = new Date(Date.UTC(depositedAt.getUTCFullYear(), depositedAt.getUTCMonth(), depositedAt.getUTCDate()));
  return { publishedAt: day, publicationTime: day.toISOString().slice(0, 10), dateBasis: "created", depositedAt, depositLagDays: 0 };
}

/** The abstract as plain text. Crossref carries it as JATS XML, headings included, for about half of the works. */
export function abstractText(abstract: string | undefined): string | null {
  if (!abstract) return null;
  const text = collapseWhitespace(decodeEntities(stripTags(abstract))).replace(/^(abstract|summary)\s*[:.\-—]?\s*/i, "");
  return text.length >= 40 ? text : null;
}

/** The authors as one line for the article's author field (three names, then "et al."). */
export function authorLine(work: CrossrefWork): string | null {
  const names = (work.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ").trim()).filter(Boolean);
  if (!names.length) return null;
  return `${names.slice(0, 3).join(", ")}${names.length > 3 ? " et al." : ""}`.slice(0, 200);
}

/**
 * What is not a paper: errata, corrections, retractions, editors' notes and the pages a journal puts in
 * front of an issue. They are deposited as journal articles with nothing else to tell them by.
 */
export function isFrontMatter(title: string): boolean {
  const t = collapseWhitespace(title);
  return /^(?:errata|erratum|corrigend(?:um|a)|retraction(?:\s+notes?)?|withdrawal|withdrawn|publisher(?:'s|’s)? (?:note|correction)|announcement|call for papers|in memoriam|obituary)\b/i.test(t)
    || /^(?:corrections?|retractions?|withdrawal)\s+(?:to|of)\b/i.test(t)
    // A bare "Correction": journals that file one per article deposit it under that title alone.
    || /^corrections?$/i.test(t)
    // A book review describes someone else's book; there is no finding to pick it for.
    || /^(?:book|software|media) reviews?(?:\s*:\s|\s+of\b)|^(?:books|book reviews) (?:received|in brief)/i.test(t)
    || /^(?:editorial(?:\s+board)?|editors?'? introduction|guest editors?'? introduction|in this issue|issue information|contents$|contents\s*[:(\d-]|table of contents|acknowledg(?:e)?ments?|front matter|(?:author|subject|volume) index|list of reviewers|referees)\b/i.test(t);
}

/** A work as the site stores it; null when it is not a paper, has no title or no publication date. */
export function toPaper(work: CrossrefWork, now: Date): PaperDraft | null {
  const doi = work.DOI?.trim().toLowerCase();
  // Titles come as JATS, as abstracts do ("Fisheries <i>and</i> growth &amp; decline").
  const title = collapseWhitespace(decodeEntities(stripTags(work.title?.[0] ?? ""))).trim();
  if (!doi || !title || isFrontMatter(title)) return null;
  const day = publicationDay(work);
  // Match ingestion's clock tolerance: a farther-future issue date is not a usable publication time.
  if (!day || day.publishedAt.getTime() > now.getTime() + 3600_000) return null;
  return {
    doi, url: `https://doi.org/${doi}`, title, author: authorLine(work), abstract: abstractText(work.abstract),
    publishedAt: day.publishedAt, publicationTime: day.publicationTime, dateBasis: day.dateBasis, depositedAt: day.depositedAt, depositLagDays: day.depositLagDays,
  };
}

/** All the ISSNs in groups Crossref accepts in one request. */
export function issnBatches(issns: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < issns.length; i += ISSNS_PER_REQUEST) out.push(issns.slice(i, i + ISSNS_PER_REQUEST));
  return out;
}
