"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import UnitSwipeNavigation from "@/app/components/UnitSwipeNavigation";

const LAST_PEREK = 929;

/**
 * Touch-only chapter navigation in the text view, following the app's RTL
 * direction. Resolves the current perek from the /929 pathname and
 * delegates the gesture handling to the shared UnitSwipeNavigation.
 */
export default function PerekSwipeNavigation({
	children,
	className,
}: {
	children: ReactNode;
	className: string;
}) {
	const pathname = usePathname();
	const perekId = Number(pathname.match(/^\/929\/([1-9]\d*)(?:\/|$)/)?.[1]);
	const inRange = perekId >= 1 && perekId <= LAST_PEREK;
	const prevHref =
		inRange && perekId > 1 ? `/929/${perekId - 1}` : null;
	const nextHref =
		inRange && perekId < LAST_PEREK ? `/929/${perekId + 1}` : null;

	return (
		<UnitSwipeNavigation
			prevHref={prevHref}
			nextHref={nextHref}
			className={className}
		>
			{children}
		</UnitSwipeNavigation>
	);
}
