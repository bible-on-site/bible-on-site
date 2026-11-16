/**
 * Agent Skills content (issue #3257): real skills that teach agents how to
 * use the public corpus correctly — discover URLs, run the anonymous search
 * API, and keep attribution — served under `/.well-known/agent-skills/`
 * per the Agent Skills discovery spec v0.2.0 (agentskills.io). Each skill is
 * a `skill-md` artifact: one SKILL.md file whose YAML frontmatter repeats
 * the name and description the index publishes.
 */
import "server-only";
import { createHash } from "node:crypto";

export interface AgentSkill {
	/** Skill directory name — lowercase-hyphen, also the [name] route param. */
	name: string;
	/** One-sentence summary, repeated in the index and the frontmatter. */
	description: string;
	/** Full SKILL.md body including the frontmatter block. */
	body: string;
	/**
	 * 2-5 natural-language asks the skill answers — the ARD/AI Catalog
	 * manifest indexes entries by these, so phrase them as asked, not as
	 * described.
	 */
	queries: string[];
}

const CORPUS_MAP_BODY = `---
name: tanah-corpus-map
description: Map the canonical URL families of the תנ"ך על הפרק public corpus and traverse it completely through the sitemap — perakim, articles, perushim, authors, parashiot, masora, moadim and Tanahpedia.
---

# tanah-corpus-map

Use this when you need a complete, bounded traversal of the תנ"ך על הפרק
public learning corpus, or need to construct a canonical URL for a known
chapter, article, commentary, reading unit or encyclopedia entry.

## Canonical URL families

Every page is fully rendered Hebrew HTML (SSG) — no client-side rendering
or login is required.

- \`/929\` — landing page for the 929 daily-chapter cycle.
- \`/929/{perekId}\` — canonical Masoretic chapter text, \`perekId\` is 1-929.
  Vocalized scripture (niqqud, teamim) with qri/ktiv and stuma (ס)/ptuha (פ)
  markers is present in the served markup, as are recitation audio URLs.
- \`/929/{perekId}/{articleId}\` — a full attributed study article
  (\`articleId\` is numeric).
- \`/929/{perekId}/{perushName}\` — one commentary's complete notes for the
  chapter, each note carrying its pasuk reference (\`perushName\` is the
  Hebrew parshan name, e.g. \`/929/1/רש"י\`).
- \`/929/authors\` and \`/929/authors/{author}\` — author index and
  per-author article lists.
- \`/פרשה/{slug}\` — weekly synagogue Torah readings including auxiliary
  Haftarah readings; \`{slug}\` is the canonical Hebrew parasha name.
- \`/מסורה/{unitId}\` — Masoretic stuma/ptuha units, including mid-verse
  boundaries. These pages are intentionally \`noindex, follow\` and are NOT
  in the sitemap: discover them by following the unit links from \`/מסורה\`
  or a sefer's מסורה section.
- \`/מועדים/{slug}\` — published festival readings (unpublished moadim are
  absent, not stubbed).
- \`/pedia/{slug}\` — Tanahpedia entity encyclopedia: people, places,
  animals and categories; aliases and disambiguation pages redirect.

## Traversal

1. Fetch \`/sitemap.xml\` — the complete index of indexable canonical URLs
   (perakim, articles, perushim, authors, pedia entries/categories,
   moadim, parashiot, sections).
2. For masora readings — the one deliberately noindex family — follow the
   unit links served on \`/מסורה\`.
3. Fetch bounded pages at a reasonable pace. There is no bulk export and
   no alternate full-corpus representation; the HTML is the corpus.

## Semantics to preserve

- 404 means the content does not exist or is unpublished — do not retry
  it as if transient. A transient backend failure is a retryable 5xx and
  is never a page's "no content" state.
- Legacy aliases (\`/tanahpedia/*\`, \`/parasha/*\`, parasha slug variants)
  answer 308 permanent redirects to the canonical URL — update references.
- Scripture keeps qri/ktiv semantics and exact Masoretic segment bounds;
  do not merge, reorder or truncate reading ranges when quoting.
`;

const CORPUS_SEARCH_BODY = `---
name: tanah-corpus-search
description: Query the תנ"ך על הפרק anonymous public search API at /api/search — parameters, result types, availability semantics and error handling for corpus-wide Hebrew search.
---

# tanah-corpus-search

Use this to find perakim, pesukim, perushim, authors, articles or
Tanahpedia entries by content instead of crawling pages.

## Endpoint

\`GET /api/search?q={query}&type={csv}&limit={1-50}\` — anonymous, JSON,
no key or session.

- \`q\` — required, 1-256 characters after trimming (Hebrew or Latin).
- \`type\` — optional comma-separated filter; any of
  \`perek,pasuk,perush,author,article,tanahpedia\`. Absent means all types.
- \`limit\` — optional, 1-50, default 10; max results per type.

## Response (HTTP 200)

\`{ query, types, results, counts, availability }\`

- \`results[]\` — ordered by relevance within each type; each hit carries
  \`type\`, \`title\`, \`snippetHtml\` (excerpt, may contain \`<mark>\`),
  \`href\` (site-relative canonical URL — resolve it against the origin)
  and \`score\`.
- \`counts\` — returned result counts keyed by successful result type.
- \`availability\` — READ THIS even on 200: a nonempty array means one or
  more providers reported partial failure and results are incomplete;
  retry later rather than caching the partial set.

## Errors

- 400 \`invalid_query\` (missing/blank q), \`invalid_limit\`, or
  \`invalid_type\` (no recognized type value).
- 414 \`invalid_query\` — the query exceeds 256 characters after trimming.
- 500 \`search_failed\` — uncaught backend failure; retry later.

Responses are \`Cache-Control: no-store\`: query freely, but re-issue the
query rather than serving a cached result.
`;

const CORPUS_CITATION_BODY = `---
name: tanah-corpus-citation
description: Attribute תנ"ך על הפרק corpus content correctly — author and parshan credits, source licences, canonical links, and the Hebrew terminology (sefer, perek, pasuk, perush, parasha, masora) to use when quoting.
---

# tanah-corpus-citation

Use this whenever you quote, summarize, embed or train on תנ"ך על הפרק
content so attribution and terminology stay correct.

## Attribution rules

- Articles are signed per author — keep the author name and link the
  article's canonical \`/929/{perekId}/{articleId}\` URL or the author's
  \`/929/authors/{author}\` page.
- Commentary notes belong to their parshan (e.g. רש"י, רמב"ן) — keep the
  parshan name and the pasuk reference each note carries.
- Scripture text is the Masoretic Tanah with niqqud and teamim; parasha
  divisions follow לוח יעקב מתלון as noted on \`/פרשה\` pages.
- Tanahpedia entries are written in full by the project — cite
  \`/pedia/{slug}\` when reusing them.
- Corpus texts carry source-specific licences; preserve the source
  credits shown on each page when redistributing. Site terms live under
  \`/tos\`; the project contact is listed on \`/contact\`.

## Terminology (use these, not Christian terms)

| Term | Meaning |
| ---- | ------- |
| Tanah (תנ"ך) | the Hebrew canon (say Tanah, not "Bible") |
| Sefer (pl. Sefarim) | a book of the Tanah |
| Perek (pl. Perakim) | a chapter — /929/{perekId} |
| Pasuk (pl. Pesukim) | a verse |
| Parasha | weekly synagogue reading unit — /פרשה/{slug} |
| Perush / Parshan | a commentary / its author |
| Masora unit | stuma/ptuha parasha division — /מסורה |
| Moed (pl. Moadim) | a festival reading — /מועדים |

## Quoting scripture

Keep niqqud, teamim and maqaf exactly as served; preserve qri (read)
versus ktiv (written) semantics — do not flatten a qri/ktiv pair into one
form; keep stuma (ס) and ptuha (פ) markers in position. Reuse is welcome
for search, AI answers and training — see /llms.txt and /robots.txt for
the open-corpus policy (Content-Signal: search=yes, ai-input=yes,
ai-train=yes). Training does not require a link back, though citations in
generated answers are appreciated.
`;

/**
 * The published skills, in index order. Names double as the
 * `/.well-known/agent-skills/{name}/SKILL.md` route segments — keep them
 * lowercase-hyphen per the spec.
 */
export const AGENT_SKILLS: AgentSkill[] = [
	{
		name: "tanah-corpus-map",
		description:
			'Map the canonical URL families of the תנ"ך על הפרק public corpus and traverse it completely through the sitemap — perakim, articles, perushim, authors, parashiot, masora, moadim and Tanahpedia.',
		body: CORPUS_MAP_BODY,
		queries: [
			"list every canonical page in the corpus",
			"find the masora reading for a chapter",
			"where are the festival (moadim) readings",
		],
	},
	{
		name: "tanah-corpus-search",
		description:
			"Query the תנ\"ך על הפרק anonymous public search API at /api/search — parameters, result types, availability semantics and error handling for corpus-wide Hebrew search.",
		body: CORPUS_SEARCH_BODY,
		queries: [
			"search the corpus for a pasuk phrase",
			"find articles about a topic",
			"look up a Tanahpedia entry by name",
		],
	},
	{
		name: "tanah-corpus-citation",
		description:
			'Attribute תנ"ך על הפרק corpus content correctly — author and parshan credits, source licences, canonical links, and the Hebrew terminology (sefer, perek, pasuk, perush, parasha, masora) to use when quoting.',
		body: CORPUS_CITATION_BODY,
		queries: [
			"how do I attribute an article from this site",
			"what is the right term for a chapter of Tanah",
			"what are the licence rules for quoting commentary",
		],
	},
];

export function skillByName(name: string): AgentSkill | undefined {
	return AGENT_SKILLS.find((skill) => skill.name === name);
}

/** The exact bytes the SKILL.md route serves — digests hash this string. */
export function skillDigest(skill: AgentSkill): string {
	return `sha256:${createHash("sha256").update(skill.body, "utf8").digest("hex")}`;
}

/**
 * The v0.2.0 discovery index body. `url` values are absolute so clients
 * never have to resolve relative references against the index URL.
 */
export function agentSkillsIndex(origin: string) {
	return {
		$schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
		skills: AGENT_SKILLS.map((skill) => ({
			name: skill.name,
			type: "skill-md" as const,
			description: skill.description,
			url: `${origin}/.well-known/agent-skills/${skill.name}/SKILL.md`,
			digest: skillDigest(skill),
		})),
	};
}
