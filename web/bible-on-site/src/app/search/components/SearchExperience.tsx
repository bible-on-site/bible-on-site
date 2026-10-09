"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	parseSearchTypes,
	SEARCH_LIMIT_DEFAULT,
	SEARCH_RESULT_TYPES,
	SEARCH_TYPE_LABELS,
	SEARCH_TYPE_ORDER,
	type SearchResponse,
	type SearchResultType,
} from "@/lib/search/types";
import styles from "./search-experience.module.css";

const DEBOUNCE_MS = 300;
const CLIENT_CACHE_MAX = 30;

/** Canonical params key: dedupes equivalent states (all-types = no type). */
function paramsKey(query: string, types: readonly SearchResultType[]): string {
	const sorted = [...types].sort();
	return `${sorted.join(",")} ${query.trim()}`;
}

function canonicalHref(
	query: string,
	types: readonly SearchResultType[],
): string {
	const params = new URLSearchParams();
	const trimmed = query.trim();
	if (trimmed) params.set("q", trimmed);
	if (types.length !== SEARCH_RESULT_TYPES.length) {
		params.set("type", [...types].sort().join(","));
	}
	const suffix = params.toString();
	return `/search${suffix ? `?${suffix}` : ""}`;
}

function apiHref(query: string, types: readonly SearchResultType[]): string {
	const params = new URLSearchParams();
	params.set("q", query.trim());
	params.set("limit", String(SEARCH_LIMIT_DEFAULT));
	if (types.length !== SEARCH_RESULT_TYPES.length) {
		params.set("type", [...types].sort().join(","));
	}
	return `/api/search?${params.toString()}`;
}

interface SearchExperienceProps {
	initialQuery: string;
	initialTypes: SearchResultType[];
	initialResults: SearchResponse | null;
	/** The SSR search itself failed (e.g. infrastructure) — show the error state. */
	initialError?: boolean;
}

type Status = "idle" | "loading" | "success" | "error";

export function SearchExperience({
	initialQuery,
	initialTypes,
	initialResults,
	initialError = false,
}: SearchExperienceProps) {
	const searchParams = useSearchParams();

	const urlQuery = (searchParams.get("q") ?? "").trim();
	// getAll: the no-JS form path submits repeated type= params; a missing
	// param means "all types" (handled inside parseSearchTypes).
	const typeParamKey = searchParams.getAll("type").join(",");
	const urlTypes = useMemo(
		() => parseSearchTypes(typeParamKey.length ? typeParamKey : null),
		[typeParamKey],
	);
	const urlKey = paramsKey(urlQuery, urlTypes);

	const [input, setInput] = useState(initialQuery);
	const [results, setResults] = useState<SearchResponse | null>(initialResults);
	const [status, setStatus] = useState<Status>(
		initialResults ? "success" : initialError ? "error" : "idle",
	);

	/**
	 * Key of the state the current `results` correspond to — the SSR payload
	 * or the latest completed fetch. Guards both refetching what is on screen
	 * and letting an older response overwrite a newer one (obsolete responses
	 * are dropped, mirroring the native app's version guard).
	 */
	const resolvedFor = useRef(
		initialResults ? paramsKey(initialQuery, initialTypes) : null,
	);
	const clientCache = useRef(new Map<string, SearchResponse>());
	/**
	 * Key of the last history entry this component pushed itself. Lets the
	 * URL→input sync distinguish its own pushes (do not touch the text the
	 * user is typing) from external Back/Forward navigations (adopt the URL).
	 */
	const lastPushedKey = useRef<string | null>(null);
	const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const urlTypesRef = useRef(urlTypes);
	urlTypesRef.current = urlTypes;

	/**
	 * Commit a query+filter state as its own history entry (native pushState:
	 * updates useSearchParams without an RSC round-trip). Each *settled*
	 * query gets one entry — keystrokes are debounced so history is not
	 * spammed — so Back/Forward walks meaningful search states and always
	 * finds the matching results (client cache or refetch).
	 */
	const settle = (query: string, types: readonly SearchResultType[]) => {
		const href = canonicalHref(query, types);
		const current = `${window.location.pathname}${window.location.search}`;
		if (current !== href) {
			lastPushedKey.current = paramsKey(query, types);
			window.history.pushState(window.history.state, "", href);
		}
	};

	// Adopt a fresh SSR payload after a real server re-render (hard nav or
	// router.refresh); native-history states never change these props.
	const initialKey = paramsKey(initialQuery, initialTypes);
	const [lastInitialKey, setLastInitialKey] = useState(initialKey);
	if (initialKey !== lastInitialKey) {
		setLastInitialKey(initialKey);
		resolvedFor.current = initialKey;
		setResults(initialResults);
		setStatus(initialResults ? "success" : initialError ? "error" : "idle");
		setInput(initialQuery);
	}

	// URL → input: adopt the query only for external navigations (Back,
	// Forward, a shared link). Pushes this component made itself already
	// carry the current input.
	useEffect(() => {
		if (urlKey !== lastPushedKey.current) {
			setInput(urlQuery);
		}
	}, [urlKey, urlQuery]);

	// Input → URL: debounce keystrokes into a settled history entry. The
	// urlTypesRef read keeps this effect dependent on keystrokes only;
	// filter toggles settle immediately in their own handler.
	useEffect(() => {
		settleTimer.current = setTimeout(() => {
			const types = urlTypesRef.current;
			const href = canonicalHref(input, types);
			const current = `${window.location.pathname}${window.location.search}`;
			if (current !== href) {
				lastPushedKey.current = paramsKey(input, types);
				window.history.pushState(window.history.state, "", href);
			}
		}, DEBOUNCE_MS);
		return () => clearTimeout(settleTimer.current);
	}, [input]);

	// URL → results: resolve the current state from the client cache or a
	// cancellable fetch. Runs once per settled/committed entry.
	useEffect(() => {
		if (urlKey === resolvedFor.current) return;
		if (!urlQuery) {
			resolvedFor.current = urlKey;
			setResults(null);
			setStatus("idle");
			return;
		}
		const cached = clientCache.current.get(urlKey);
		if (cached) {
			clientCache.current.delete(urlKey);
			clientCache.current.set(urlKey, cached);
			resolvedFor.current = urlKey;
			setResults(cached);
			setStatus("success");
			return;
		}
		setStatus("loading");
		const controller = new AbortController();
		void (async () => {
			try {
				const response = await fetch(apiHref(urlQuery, urlTypes), {
					signal: controller.signal,
				});
				if (!response.ok) {
					throw new Error(`search failed: ${response.status}`);
				}
				const data = (await response.json()) as SearchResponse;
				clientCache.current.set(urlKey, data);
				while (clientCache.current.size > CLIENT_CACHE_MAX) {
					const oldest = clientCache.current.keys().next().value;
					if (oldest === undefined) break;
					clientCache.current.delete(oldest);
				}
				resolvedFor.current = urlKey;
				setResults(data);
				setStatus("success");
			} catch (error) {
				if (controller.signal.aborted) return;
				console.warn(
					"[search] fetch failed:",
					error instanceof Error ? error.message : error,
				);
				setStatus("error");
			}
		})();
		return () => controller.abort();
	}, [urlKey, urlQuery, urlTypes]);

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		clearTimeout(settleTimer.current);
		settle(input, urlTypes);
	};

	const onTypeToggle = (type: SearchResultType, checked: boolean) => {
		const next = checked
			? [...new Set([...urlTypes, type])]
			: urlTypes.filter((value) => value !== type);
		clearTimeout(settleTimer.current);
		settle(input, next);
	};

	const inputRef = useRef<HTMLInputElement>(null);
	const resultsRef = useRef<HTMLDivElement>(null);

	const resultLinks = () =>
		Array.from(
			resultsRef.current?.querySelectorAll<HTMLAnchorElement>(
				"a[data-result-link]",
			) ?? [],
		);

	const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			const first = resultLinks()[0];
			if (first) {
				event.preventDefault();
				first.focus();
			}
		} else if (event.key === "Escape" && input) {
			event.preventDefault();
			clearTimeout(settleTimer.current);
			setInput("");
			settle("", urlTypes);
		}
	};

	const onResultKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
		const links = resultLinks();
		const index = links.indexOf(event.currentTarget);
		if (event.key === "ArrowDown") {
			event.preventDefault();
			links[(index + 1) % links.length]?.focus();
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			if (index <= 0) {
				inputRef.current?.focus();
			} else {
				links[index - 1]?.focus();
			}
		} else if (event.key === "Escape") {
			event.preventDefault();
			inputRef.current?.focus();
		}
	};

	const totalCount = results
		? Object.values(results.counts).reduce((sum, count) => sum + count, 0)
		: 0;

	const statusMessage =
		status === "loading"
			? "מחפש..."
			: status === "error"
				? "שגיאה בחיפוש. נסו שוב"
				: results && urlQuery
					? totalCount > 0
						? `נמצאו ${totalCount} תוצאות`
						: "לא נמצאו תוצאות"
					: "";

	return (
		<div className={styles.experience}>
			<search>
				<form
					action="/search"
					method="get"
					onSubmit={onSubmit}
					className={styles.searchForm}
				>
					<div className={styles.inputRow}>
						<input
							ref={inputRef}
							type="search"
							name="q"
							value={input}
							onChange={(event) => setInput(event.target.value)}
							onKeyDown={onInputKeyDown}
							placeholder="חפשו פרק, פסוק, פירוש, רב או מאמר..."
							aria-label="מונח חיפוש"
							autoComplete="off"
							className={styles.searchInput}
						/>
						<button type="submit" className={styles.searchButton}>
							חיפוש
						</button>
					</div>
					<fieldset className={styles.filters}>
						<legend className={styles.filtersLegend}>מה לחפש</legend>
						{SEARCH_RESULT_TYPES.map((type) => (
							<label key={type} className={styles.filterChip}>
								<input
									type="checkbox"
									name="type"
									value={type}
									checked={urlTypes.includes(type)}
									onChange={(event) =>
										onTypeToggle(type, event.target.checked)
									}
								/>
								<span>{SEARCH_TYPE_LABELS[type]}</span>
							</label>
						))}
					</fieldset>
				</form>
			</search>

			{/* Polite live region announces state changes to screen readers. */}
			<div role="status" aria-live="polite" className={styles.statusLine}>
				{statusMessage}
			</div>
			{results?.availability.map((message) => (
				<div key={message} role="status" className={styles.availabilityLine}>
					{message}
				</div>
			))}

			<div ref={resultsRef}>
				{results && totalCount > 0 ? (
					<SearchResults
						response={results}
						onResultKeyDown={onResultKeyDown}
					/>
				) : results && urlQuery && status !== "loading" ? (
					<p className={styles.emptyState}>
						לא נמצאו תוצאות עבור &quot;{urlQuery}&quot;
					</p>
				) : !urlQuery ? (
					<p className={styles.emptyState}>
						הקלידו מונח חיפוש כדי למצוא פרקים, פסוקים, פירושים, רבנים ומאמרים.
					</p>
				) : null}
			</div>
		</div>
	);
}

function SearchResults({
	response,
	onResultKeyDown,
}: {
	response: SearchResponse;
	onResultKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => void;
}) {
	return (
		<div>
			{SEARCH_TYPE_ORDER.map((type) => {
				const items = response.results.filter((item) => item.type === type);
				if (items.length === 0) return null;
				return (
					<section key={type} aria-labelledby={`search-group-${type}`}>
						<h2 id={`search-group-${type}`} className={styles.groupTitle}>
							{SEARCH_TYPE_LABELS[type]}
							<span className={styles.groupCount}>{items.length}</span>
						</h2>
						<ul className={styles.resultList}>
							{items.map((item) => (
								<li key={`${item.type}:${item.href}:${item.title}`}>
									<Link
										href={item.href}
										data-result-link=""
										className={styles.resultLink}
										onKeyDown={onResultKeyDown}
									>
										<span className={styles.resultTitle}>{item.title}</span>
										{item.snippetHtml ? (
											<span
												className={styles.resultSnippet}
												// biome-ignore lint/security/noDangerouslySetInnerHtml: snippet is built server-side with every input byte escaped; only <mark> tags are emitted
												dangerouslySetInnerHTML={{
													__html: item.snippetHtml,
												}}
											/>
										) : null}
									</Link>
								</li>
							))}
						</ul>
					</section>
				);
			})}
		</div>
	);
}
