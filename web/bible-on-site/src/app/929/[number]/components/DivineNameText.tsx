"use client";
import { useSyncExternalStore } from "react";
import { maskDivineNameValue } from "@/lib/divine-name-masking";
import {
	getDivineNameMaskingServerSnapshot,
	getDivineNameMaskingSnapshot,
	subscribeDivineNameMasking,
} from "@/lib/divine-name-settings";

/**
 * A single canonical segment value, displayed with הסתר שם השם masking
 * applied per the user's preference. SSR/hydration render the canonical
 * text (search engines and first paint stay intact); after mount the
 * stored preference is applied, and later changes re-render in place.
 */
export function DivineNameText({ value }: { value: string }) {
	const settings = useSyncExternalStore(
		subscribeDivineNameMasking,
		getDivineNameMaskingSnapshot,
		getDivineNameMaskingServerSnapshot,
	);
	return <>{maskDivineNameValue(value, settings)}</>;
}
