"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	PerushSummary,
	RangePerushSummary,
	RangedPerushNote,
} from "@/lib/perushim";
import type { DivisionId } from "@/lib/reading/contract";
import { PerushimSection } from "@/app/929/[number]/components/PerushimSection";
import { getUnitPerushNotes } from "./actions";
import { RangedPerushView } from "./RangedPerushView";
import {
	perushParamName,
	type UnitPerushScope,
	unitPathWithoutPerush,
	unitPerushHref,
} from "./unit-perush";

interface UnitPerushimSectionProps {
	/** The alternative division this unit belongs to ("masora"/"parasha"). */
	division: DivisionId;
	unitId: number;
	/** "torah" bounds to the unit's primary ranges; "haftara" to its auxiliary readings. */
	scope: UnitPerushScope;
	/** Public unit path (e.g. "/מסורה/5") — base for perush deep links. */
	unitPath: string;
	/** Fallback perek for default perush hrefs (unused while hrefForPerush is set). */
	perekId: number;
	perushim?: RangePerushSummary[] | null;
	title: string;
	emptyMessage: string;
	scrollStorageKey?: string;
	/** Canonical perek source labels (e.g. "בראשית ג") by perekId. */
	perekSources?: Record<number, string>;
}

/**
 * Perushim carousel of an alternative-division unit page, upgraded to
 * keep the open perush inside the division (issue #2190).
 *
 * Selecting a perush writes its name to the unit URL's scope param
 * (`?perush=` / `?haftaraPerush=`) instead of navigating to /929, then
 * swaps the carousel for a RangedPerushView whose notes the
 * getUnitPerushNotes action clips to the unit's canonical bounds —
 * cross-perek parashot and Haftarah scopes included. Selection is
 * derived from the URL only, so browser back/forward, deep links, unit
 * switches, and reader-mode toggles all refresh the bounds without
 * stale commentary; fetched notes stay keyed to their selection so a
 * response from a previous selection can never render under a new one,
 * and a param naming a perush the unit doesn't carry is cleaned from
 * the URL.
 */
export function UnitPerushimSection({
	division,
	unitId,
	scope,
	unitPath,
	perekId,
	perushim = [],
	title,
	emptyMessage,
	scrollStorageKey,
	perekSources,
}: UnitPerushimSectionProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const paramName = perushParamName(scope);
	const search = searchParams.toString();

	const safePerushim = perushim ?? [];
	const selectedName = searchParams.get(paramName);
	const selected = selectedName
		? safePerushim.find((perush) => perush.name === selectedName)
		: undefined;
	const selectionKey = selected
		? `${division}:${unitId}:${scope}:${selected.id}`
		: null;

	const [fetched, setFetched] = useState<{
		key: string;
		notes: RangedPerushNote[];
	} | null>(null);
	// Notes only render when they belong to the current selection —
	// an async response for a previous selection can never slip in.
	const notes = fetched?.key === selectionKey ? fetched.notes : null;
	const viewRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (selectionKey == null || selected?.id == null) return;
		const perushId = selected.id;
		let cancelled = false;
		getUnitPerushNotes(division, unitId, scope, perushId)
			.then((fetchedNotes) => {
				if (!cancelled) setFetched({ key: selectionKey, notes: fetchedNotes });
			})
			.catch((error) => {
				console.error("Failed to load bounded commentary", {
					division,
					unitId,
					scope,
					perushId,
					error,
				});
				if (!cancelled) setFetched({ key: selectionKey, notes: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [division, unitId, scope, selectionKey, selected?.id]);

	// A param naming a perush outside this unit/scope can never render —
	// clean it from the URL rather than leave a dead selection.
	useEffect(() => {
		if (!selectedName || selected) return;
		router.replace(unitPathWithoutPerush(unitPath, scope, search), {
			scroll: false,
		});
	}, [selectedName, selected, unitPath, scope, search, router]);

	// Bring the opened commentary into view once its notes land; for a
	// deep link this mirrors the /929 perush page's scroll-to-view.
	useEffect(() => {
		if (notes == null) return;
		viewRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
	}, [notes]);

	const hrefForPerush = useCallback(
		(perush: PerushSummary) =>
			unitPerushHref(unitPath, scope, perush.name, search),
		[unitPath, scope, search],
	);

	const openPerush = useCallback(
		(perush: PerushSummary) => {
			router.push(hrefForPerush(perush), { scroll: false });
		},
		[hrefForPerush, router],
	);

	const closePerush = useCallback(() => {
		router.push(unitPathWithoutPerush(unitPath, scope, search), {
			scroll: false,
		});
	}, [unitPath, scope, search, router]);

	if (selected && notes != null) {
		return (
			<div ref={viewRef} data-unit-perush-open={scope}>
				<RangedPerushView
					name={selected.name}
					parshanName={selected.parshanName}
					notes={notes}
					onBack={closePerush}
					perekSources={perekSources}
					sharePath={`/929/${selected.perekId}/${encodeURIComponent(selected.name)}`}
					emptyMessage={emptyMessage}
					scope={scope}
				/>
			</div>
		);
	}

	return (
		<PerushimSection
			perekId={perekId}
			perushim={safePerushim}
			title={title}
			emptyMessage={emptyMessage}
			onPerushClick={openPerush}
			hrefForPerush={hrefForPerush}
			loading={selected != null}
			scrollStorageKey={scrollStorageKey}
		/>
	);
}
