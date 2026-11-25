import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

export function seferContentFromRoute(
	route: string,
): { perekId: number; slug: string; further: boolean } | null {
	const [pathname, query = ""] = route.split("?");
	const params = new URLSearchParams(query);
	if (!params.has("book")) return null;
	const match = pathname.match(/^\/929\/(\d+)\/([^/]+)$/);
	if (match) {
		return {
			perekId: Number(match[1]),
			slug: decodeURIComponent(match[2]),
			further: false,
		};
	}
	// לקריאה נוספת (#3752): a secondary-coverage selection rides a query
	// parameter on the *browsed* chapter's route — the article's own perek
	// differs, so the /929/{perek}/{slug} form would 404 on reload.
	const perekOnly = pathname.match(/^\/929\/(\d+)$/);
	const further = params.get("further");
	if (perekOnly && further) {
		return { perekId: Number(perekOnly[1]), slug: further, further: true };
	}
	return null;
}

export function writeSeferContentHistory(
	perekId: number,
	slug?: string,
	replace = false,
	further = false,
) {
	const route =
		further && slug
			? `/929/${perekId}?book&further=${encodeURIComponent(slug)}`
			: `/929/${perekId}${slug ? `/${encodeURIComponent(slug)}` : ""}?book`;
	// Preserve both the router's state and the flipbook's ownership marker.
	// The book restores this entry itself, without a router navigation.
	const state = { ...history.state, route };
	const method = replace
		? History.prototype.replaceState
		: History.prototype.pushState;
	method.call(history, state, "", route);
	return route;
}

export function useSeferContentNavigation(
	perekId: number,
	initialSlug?: string,
	initialFurther = false,
) {
	const [content, setContent] = useState(() =>
		initialSlug ? { perekId, slug: initialSlug, further: initialFurther } : null,
	);
	const initialContent = useRef(content);
	const mounted = useRef(false);
	useLayoutEffect(() => {
		mounted.current = true;
		const restore = () =>
			setContent(seferContentFromRoute(location.pathname + location.search));
		// Register before FlipBook's passive effect installs its capture listener,
		// which stops popstate propagation for book-owned entries.
		window.addEventListener("popstate", restore, true);
		return () => {
			mounted.current = false;
			window.removeEventListener("popstate", restore, true);
		};
	}, []);

	useEffect(() => {
		setContent(
			initialSlug
				? { perekId, slug: initialSlug, further: initialFurther }
				: null,
		);
	}, [perekId, initialSlug, initialFurther]);

	const navigate = useCallback(
		(chapterId: number, slug?: string, further = false) => {
			writeSeferContentHistory(chapterId, slug, false, further);
			setContent(slug ? { perekId: chapterId, slug, further } : null);
		},
		[],
	);

	const onPageFlipped = useCallback(() => {
		// FlipBook calls onPageFlipped immediately before writing its URL. Read
		// that URL after the synchronous write, including on history restoration.
		const deepLink =
			seferContentFromRoute(location.pathname + location.search) ??
			initialContent.current;
		initialContent.current = null;
		queueMicrotask(() => {
			if (!mounted.current) return;
			// A TOC turn may finish after an item on the visible page was chosen.
			// Keep that choice when the book commits the same chapter. A turn to
			// another chapter/TOC, or a newer deep link, owns its resulting URL.
			if (
				deepLink &&
				location.pathname === `/929/${deepLink.perekId}` &&
				new URLSearchParams(location.search).has("book")
			) {
				writeSeferContentHistory(
					deepLink.perekId,
					deepLink.slug,
					true,
					deepLink.further,
				);
			}
			setContent(seferContentFromRoute(location.pathname + location.search));
		});
	}, []);

	return { content, navigate, onPageFlipped };
}
