// OpenAlex: batch abstract recovery by DOI for publishers (such as Elsevier) whose Crossref records omit abstracts.
// Pure HTTP + parsing here so standalone tests run without a database.
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { abstractText } from "./crossref.ts";

export const OPENALEX_WORKS = "https://api.openalex.org/works";
/** OpenAlex allows up to 50 pipe-separated DOIs per filter query on a single page. */
export const DOIS_PER_REQUEST = 50;
const RETRIES = 4;
const BASE_USER_AGENT = "econ-literature-site/0.1 (daily literature digest; https://github.com/confidentxin/econ-mgmt-paper-daily";

export interface OpenAlexWork {
  doi?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function openalexUserAgent(mailto = process.env.OPENALEX_MAILTO): string {
  const email = mailto?.trim();
  return email ? `${BASE_USER_AGENT}; mailto:${email})` : `${BASE_USER_AGENT})`;
}

/** Canonical bare lowercase DOI ("10.1016/j.jfineco.2026.01") from either a bare DOI or a doi.org URL. */
export function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().toLowerCase();
  return /^10\.\d{4,9}\/\S+$/u.test(cleaned) ? cleaned : null;
}

/**
 * Reconstructs plain-text abstract from OpenAlex's inverted index ({ word: [positions...] }),
 * then applies the same tag/entity/heading cleanup and minimum-length check as Crossref abstracts.
 */
export function reconstructAbstract(inverted: Record<string, number[]> | null | undefined): string | null {
  if (!inverted || typeof inverted !== "object") return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    if (!word || !Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (Number.isInteger(pos) && pos >= 0 && pos < 20_000) {
        words[pos] = word;
      }
    }
  }
  if (!words.length) return null;
  return abstractText(words.filter((w): w is string => typeof w === "string" && w.length > 0).join(" "));
}

export function openalexWorksQuery(
  dois: readonly string[],
  opts: { mailto?: string; apiKey?: string } = {},
): URLSearchParams {
  const filter = `doi:${dois.map((d) => `https://doi.org/${d}`).join("|")}`;
  const params = new URLSearchParams({
    filter,
    select: "doi,abstract_inverted_index",
    "per-page": String(Math.max(1, Math.min(DOIS_PER_REQUEST, dois.length))),
  });
  const mailto = (opts.mailto ?? process.env.OPENALEX_MAILTO)?.trim();
  if (mailto) params.set("mailto", mailto);
  const apiKey = (opts.apiKey ?? process.env.OPENALEX_API_KEY)?.trim();
  if (apiKey) params.set("api_key", apiKey);
  return params;
}

export function doiBatches(dois: readonly string[]): string[][] {
  const unique = [...new Set(dois.map(normalizeDoi).filter((d): d is string => d !== null))];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += DOIS_PER_REQUEST) {
    out.push(unique.slice(i, i + DOIS_PER_REQUEST));
  }
  return out;
}

async function getJson(url: string): Promise<{ results?: OpenAlexWork[] }> {
  for (let attempt = 1; ; attempt++) {
    let response: Awaited<ReturnType<typeof guardedFetch>>;
    try {
      response = await guardedFetch(url, {
        headers: { "User-Agent": openalexUserAgent(), Accept: "application/json" },
        timeoutMs: 45_000,
        maxBytes: 16 * 1024 * 1024,
      });
    } catch (error) {
      if (attempt >= RETRIES) throw error;
      await sleep(attempt * 2_500);
      continue;
    }
    if (response.status === 200) return JSON.parse(response.text()) as { results?: OpenAlexWork[] };
    const wait = Number(response.headers.get("retry-after"));
    if ((response.status === 429 || response.status >= 500) && attempt < RETRIES) {
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 120) * 1_000 : attempt * 4_000);
      continue;
    }
    throw new Error(`OpenAlex answered ${response.status} for ${url.slice(0, 200)}`);
  }
}

/** Batch-fetches available abstracts from OpenAlex for a list of DOIs, returning a map keyed by normalized DOI. */
export async function fetchOpenAlexAbstracts(dois: readonly string[]): Promise<{ abstracts: Map<string, string>; requests: number }> {
  const abstracts = new Map<string, string>();
  let requests = 0;
  for (const batch of doiBatches(dois)) {
    requests += 1;
    const body = await getJson(`${OPENALEX_WORKS}?${openalexWorksQuery(batch)}`);
    for (const item of body.results ?? []) {
      const doi = normalizeDoi(item.doi);
      const text = reconstructAbstract(item.abstract_inverted_index);
      if (doi && text) abstracts.set(doi, text);
    }
  }
  return { abstracts, requests };
}
