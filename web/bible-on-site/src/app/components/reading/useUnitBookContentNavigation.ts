import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	type UnitBookContent,
	type UnitBookContentKind,
	type UnitBookScope,
	unitBookContentFromRoute,
	writeUnitBookContentHistory,
} from "./unit-book-content";

/**
 * In-book commentary/article navigation for alternative-division sefer
 * books (issue #2191) — the unit-route counterpart of the perek
 * reader's useSeferContentNavigation.
 *
 * Selection lives in the unit's own book URL (`{root}/{unitId}?book`
 * plus the scope params from unit-book-content), interleaved with the
 * flipbook's raw history entries, so browser Back/Forward restores an
 * open perush or article exactly like the /929 reader. The flipbook
 * owns page-level history; this hook only tracks the content params.
 *
 * `initialContent` seeds the selection when the page loads directly on
 * a content deep link (e.g. `/מסורה/5?book&perush=רש"י`).
 */
export function useUnitBookContentNavigation(
	rootPath: string,
	rootAliases: readonly string[],
	unitId: number,
	initialContent?: {
		scope: UnitBookScope;
		kind: UnitBookContentKind;
		slug: string;
	} | null,
) {
	const [content, setContent] = useState<UnitBookContent | null>(() => {
		if (!initialContent) return null;
		return {
			unitId,
			haftara: initialContent.scope === "haftara",
			[scopeParamKey(initialContent)]: initialContent.slug,
		} as UnitBookContent;
	});
	const initialDeepLink = useRef(content);
	const mounted = useRef(false);
	const roots = useRef([rootPath, ...rootAliases]);

	useLayoutEffect(() => {
		mounted.current = true;
		const restore = () =>
			setContent(
				unitBookContentFromRoute(
					location.pathname + location.search,
					roots.current,
				),
			);
		// Register before FlipBook's passive effect installs its capture
		// listener, which stops popstate propagation for book-owned entries.
		window.addEventListener("popstate", restore, true);
		return () => {
			mounted.current = false;
			window.removeEventListener("popstate", restore, true);
		};
	}, []);

	// Depend on the selection's fields rather than the object identity:
	// callers build `initialContent` inline each render, and an
	// identity-keyed effect would setContent on every render forever.
	const seedScope = initialContent?.scope;
	const seedKind = initialContent?.kind;
	const seedSlug = initialContent?.slug;
	useEffect(() => {
		setContent(
			seedScope && seedKind && seedSlug != null
				? ({
						unitId,
						haftara: seedScope === "haftara",
						[scopeParamKey({ scope: seedScope, kind: seedKind })]:
							seedSlug,
					} as UnitBookContent)
				: null,
		);
	}, [unitId, seedScope, seedKind, seedSlug]);

	const navigate = useCallback(
		(
			targetUnitId: number,
			scope: UnitBookScope,
			kind?: UnitBookContentKind,
			slug?: string,
		) => {
			writeUnitBookContentHistory(rootPath, targetUnitId, scope, kind, slug);
			setContent(
				unitBookContentFromRoute(
					location.pathname + location.search,
					roots.current,
				),
			);
		},
		[rootPath],
	);

	const onPageFlipped = useCallback(() => {
		// FlipBook calls onPageFlipped immediately before writing its URL.
		// Read that URL after the synchronous write, including on history
		// restoration.
		const deepLink = initialDeepLink.current;
		initialDeepLink.current = null;
		queueMicrotask(() => {
			if (!mounted.current) return;
			// Initialization normalizes the spread's URL to its unit route.
			// Retain the content deep link on that first initialization only.
			if (deepLink) {
				const perush = deepLink.perush ?? deepLink.haftaraPerush;
				const article = deepLink.article ?? deepLink.haftaraArticle;
				const scope: UnitBookScope =
					deepLink.haftaraPerush || deepLink.haftaraArticle
						? "haftara"
						: "torah";
				const slug = perush ?? article;
				writeUnitBookContentHistory(
					rootPath,
					deepLink.unitId,
					scope,
					perush ? "perush" : "article",
					slug,
					true,
				);
			}
			setContent(
				unitBookContentFromRoute(
					location.pathname + location.search,
					roots.current,
				),
			);
		});
	}, [rootPath]);

	return { content, navigate, onPageFlipped };
}

function scopeParamKey(selection: {
	scope: UnitBookScope;
	kind: UnitBookContentKind;
}): keyof UnitBookContent {
	if (selection.kind === "perush") {
		return selection.scope === "haftara" ? "haftaraPerush" : "perush";
	}
	return selection.scope === "haftara" ? "haftaraArticle" : "article";
}
