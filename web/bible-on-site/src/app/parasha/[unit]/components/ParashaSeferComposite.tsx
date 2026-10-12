"use client";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	startTransition,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	getStoredParashaViewMode,
	setStoredParashaViewMode,
} from "@/lib/perek-view-preference";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import divisionData from "@/data/parasha/parasha-division.json";
import { TABLET_MIN_WIDTH, useIsWideEnough } from "@/hooks/useIsWideEnough";
import ReadModeToggler from "@/app/929/[number]/components/ReadModeToggler";
import seferStyles from "@/app/929/[number]/components/sefer-composite.module.css";
import {
	parashaBookPageFromPath,
	parashaBookPageFromQuery,
	pathnameWithParashaBookQuery,
	type ParashaBookUnit,
} from "./parasha-book-utils";

// Lazy-load the heavy Sefer (FlipBook) component so its JS bundle is not
// included in the initial page load — same pattern as the /929 reader.
const ParashaLoadedSefer = dynamic(() => import("./ParashaLoadedSefer"), {
	ssr: false,
	loading: () => (
		<output
			className={seferStyles.loadingContainer}
			aria-label="טוען תצוגת ספר..."
		>
			<div className={seferStyles.loadingSpinner} />
		</output>
	),
});

function SeferLoadingIndicator() {
	return (
		<output
			className={seferStyles.loadingContainer}
			aria-label="טוען תצוגת ספר..."
		>
			<div className={seferStyles.loadingSpinner} />
		</output>
	);
}

/**
 * Flat-view ↔ sefer-book toggler for the פרשה reader. The book shows the
 * parasha's sefer sliced by parashiot, each Torah page followed by its
 * Haftarah page — never a division toggle inside /929.
 */
export const ParashaSeferComposite = (props: {
	units: ParashaBookUnit[];
	seferName: string;
	currentUnitId: number;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
	perekSources: Record<number, string>;
}) => {
	const isWideEnough = useIsWideEnough(TABLET_MIN_WIDTH);
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const appliedStoredPreference = useRef(false);
	const handledUserToggle = useRef(false);

	const toggled = searchParams.get("book") != null;
	const [everToggled, setEverToggled] = useState(false);
	const [currentlyToggled, setCurrentlyToggled] = useState(false);
	const [display, setDisplay] = useState("none");

	const handleToggle = useCallback(
		(wantBook: boolean, immediately = false) => {
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
					setTimeout(() => {
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
		if (/^#pasuk-[1-9]\d*(-\d+)?$/.test(window.location.hash)) return;
		const stored = getStoredParashaViewMode();
		if (stored === "book" && searchParams.get("book") == null) {
			const next = pathnameWithParashaBookQuery(
				pathname,
				searchParams.toString(),
				true,
			);
			router.replace(next, { scroll: false });
		}
	}, [isWideEnough, pathname, router, searchParams]);

	useEffect(() => {
		if (toggled) {
			setStoredParashaViewMode("book");
		}
	}, [toggled]);

	const onToggleFromUser = useCallback(
		(wantBook: boolean) => {
			handledUserToggle.current = true;
			setStoredParashaViewMode(wantBook ? "book" : "seo");
			const togglePath =
				!wantBook && parashaBookPageFromPath(pathname)
					? `${divisionData.rootPath}/${props.currentUnitId}`
					: pathname;
			const next = pathnameWithParashaBookQuery(
				togglePath,
				searchParams.toString(),
				wantBook,
			);
			router.replace(next, { scroll: false });
			handleToggle(wantBook, wantBook);
		},
		[handleToggle, pathname, props.currentUnitId, router, searchParams],
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

	if (isWideEnough === false) {
		return null;
	}
	const initialBookPage =
		parashaBookPageFromPath(pathname) ??
		parashaBookPageFromQuery(searchParams.get("bookPage")) ??
		(searchParams.get("toc") != null ? "toc" : null);

	return (
		<>
			<ReadModeToggler toggled={toggled} onToggle={onToggleFromUser} />
			<div
				style={{ display }}
				className={`${seferStyles.seferOverlay} ${
					currentlyToggled ? seferStyles.visible : seferStyles.hidden
				}`}
			>
				{everToggled ? (
					<ParashaLoadedSefer
						key={props.seferName}
						units={props.units}
						seferName={props.seferName}
						currentUnitId={props.currentUnitId}
						entityRefsByPerek={props.entityRefsByPerek}
						perekSources={props.perekSources}
						initialBookPage={initialBookPage}
						haftara={searchParams.get("haftara") != null}
					/>
				) : currentlyToggled ? (
					<SeferLoadingIndicator />
				) : null}
			</div>
		</>
	);
};
