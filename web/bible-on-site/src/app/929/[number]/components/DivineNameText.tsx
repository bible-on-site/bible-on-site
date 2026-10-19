"use client";
import { useSyncExternalStore } from "react";
import { maskDivineNameText } from "@/lib/divine-name-masking";
import {
	getDivineNameMaskingServerSnapshot,
	getDivineNameMaskingSnapshot,
	subscribeDivineNameMasking,
} from "@/lib/divine-name-settings";

/**
 * A canonical segment value, displayed with הסתר שם השם masking applied
 * per the user's preference. maskDivineNameText (not the single-word
 * maskDivineNameValue) is used because a segment value can hold several
 * words — bracketed multi-word qri arrives as one segment. SSR/hydration
 * render the default masking — identical to what a fresh client computes —
 * and after mount the stored preference is applied, and later changes
 * re-render in place.
 */
export function DivineNameText({ value }: { value: string }) {
	const settings = useSyncExternalStore(
		subscribeDivineNameMasking,
		getDivineNameMaskingSnapshot,
		getDivineNameMaskingServerSnapshot,
	);
	return <>{maskDivineNameText(value, settings)}</>;
}
