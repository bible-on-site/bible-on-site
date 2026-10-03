import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function seferContentFromRoute(
	route: string,
): { perekId: number; slug: string } | null {
	const [pathname, query = ""] = route.split("?");
	const match = pathname.match(/^\/929\/(\d+)\/([^/]+)$/);
	if (!match || !new URLSearchParams(query).has("book")) return null;
	return { perekId: Number(match[1]), slug: decodeURIComponent(match[2]) };
}

export function writeSeferContentHistory(
	perekId: number,
	slug?: string,
	replace = false,
) {
	const route = `/929/${perekId}${slug ? `/${encodeURIComponent(slug)}` : ""}?book`;
	// Preserve both the router's state and the flipbook's ownership marker.
	// The book restores this entry itself, without a router navigation.
	const state = { ...history.state, route };
	const method = replace
		? History.prototype.replaceState
		: History.prototype.pushState;
	method.call(history, state, "", route);
	return route;
}

export function useSeferContentNavigation(perekId: number, initialSlug?: string) {
	const [content, setContent] = useState(() =>
		initialSlug ? { perekId, slug: initialSlug } : null,
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
		setContent(initialSlug ? { perekId, slug: initialSlug } : null);
	}, [perekId, initialSlug]);

	const navigate = useCallback((chapterId: number, slug?: string) => {
		writeSeferContentHistory(chapterId, slug);
		setContent(slug ? { perekId: chapterId, slug } : null);
	}, []);

	const onPageFlipped = useCallback(() => {
		// FlipBook calls onPageFlipped immediately before writing its URL. Read
		// that URL after the synchronous write, including on history restoration.
		const deepLink = initialContent.current;
		initialContent.current = null;
		queueMicrotask(() => {
			if (!mounted.current) return;
			// Initialization normalizes the spread's URL to its chapter. Retain
			// the article/perush deep link on that first initialization only.
			if (deepLink) writeSeferContentHistory(deepLink.perekId, deepLink.slug, true);
			setContent(seferContentFromRoute(location.pathname + location.search));
		});
	}, []);

	return { content, navigate, onPageFlipped };
}
