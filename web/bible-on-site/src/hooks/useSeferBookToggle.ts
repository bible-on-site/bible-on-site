"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	startTransition,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { isPasukCitationHash } from "@/lib/pasuk-anchor";
import type { PerekViewMode } from "@/lib/perek-view-preference";

/**
 * Flat-view ↔ sefer-book toggle state machine shared by the readers:
 * persists the user's preference, applies the stored preference once
 * on wide-enough screens, owns the open/close animation timers, the
 * `data-book-view` document flag and the URL `?book` param.
 * The only per-division part is the storage pair and the path helpers,
 * passed in via `prefs`.
 */
export function useSeferBookToggle(
	isWideEnough: boolean | undefined,
	currentUnitId: number,
	prefs: {
		getStored: () => PerekViewMode | null;
		setStored: (mode: PerekViewMode) => void;
		withBookQuery: (
			pathname: string,
			currentSearch: string,
			wantBook: boolean,
		) => string;
		exitPath: (pathname: string, fallbackUnitId: number) => string;
	},
) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const appliedStoredPreference = useRef(false);
	const handledUserToggle = useRef(false);
	// The caller passes a fresh prefs literal each render; keep the
	// latest in a ref so the effects below keep their original
	// dependencies instead of re-running on every render.
	const prefsRef = useRef(prefs);
	prefsRef.current = prefs;

	const toggled = searchParams.get("book") != null;
	const [everToggled, setEverToggled] = useState(false);
	const [currentlyToggled, setCurrentlyToggled] = useState(false);
	const [display, setDisplay] = useState("none");
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (hideTimerRef.current !== null) {
				clearTimeout(hideTimerRef.current);
				hideTimerRef.current = null;
			}
		};
	}, []);

	const handleToggle = useCallback(
		(wantBook: boolean, immediately = false) => {
			if (hideTimerRef.current !== null) {
				clearTimeout(hideTimerRef.current);
				hideTimerRef.current = null;
			}
			if (wantBook) {
				setDisplay("initial");
				setCurrentlyToggled(true);
				if (!everToggled) {
					startTransition(() => {
						setEverToggled(true);
					});
				}
			} else {
				if (immediately) {
					setDisplay("none");
				} else {
					hideTimerRef.current = setTimeout(() => {
						hideTimerRef.current = null;
						setDisplay("none");
					}, 300);
				}
				window.dispatchEvent(new Event("recitation-stop"));
				setCurrentlyToggled(false);
			}
		},
		[everToggled],
	);

	// Apply saved book preference once (tablet+): add ?book if user chose sefer view.
	useEffect(() => {
		if (isWideEnough !== true || appliedStoredPreference.current) return;
		appliedStoredPreference.current = true;
		if (isPasukCitationHash(window.location.hash)) return;
		const stored = prefsRef.current.getStored();
		if (stored === "book" && searchParams.get("book") == null) {
			const next = prefsRef.current.withBookQuery(
				pathname,
				searchParams.toString(),
				true,
			);
			router.replace(next, { scroll: false });
		}
	}, [isWideEnough, pathname, router, searchParams]);

	const onToggleFromUser = useCallback(
		(wantBook: boolean) => {
			handledUserToggle.current = true;
			prefsRef.current.setStored(wantBook ? "book" : "seo");
			// While the book is open the flipbook owns the URL — on exit
			// read the live location so flipping to another unit returns
			// to that unit's flat page, and an open content selection
			// keeps its flat-page meaning via the shared params.
			const togglePath = wantBook
				? pathname
				: prefsRef.current.exitPath(
						window.location.pathname,
						currentUnitId,
					);
			const search = wantBook
				? searchParams.toString()
				: window.location.search;
			const next = prefsRef.current.withBookQuery(
				togglePath,
				search,
				wantBook,
			);
			router.replace(next, { scroll: false });
			handleToggle(wantBook, wantBook);
		},
		[handleToggle, pathname, currentUnitId, router, searchParams],
	);

	useEffect(() => {
		if (everToggled || handledUserToggle.current) return;
		const IMMEDIATELY = true;
		handleToggle(toggled, IMMEDIATELY);
	}, [toggled, handleToggle, everToggled]);

	useEffect(() => {
		if (currentlyToggled && isWideEnough === true) {
			document.documentElement.dataset.bookView = "";
		} else {
			delete document.documentElement.dataset.bookView;
		}
		return () => {
			delete document.documentElement.dataset.bookView;
		};
	}, [currentlyToggled, isWideEnough]);

	return { toggled, everToggled, currentlyToggled, display, onToggleFromUser };
}
