"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import type { UnitAliyahContextOption } from "@/data/parasha/parasha-aliyot";
import styles from "./aliyah-controls.module.css";

/**
 * Reading-context + scheme selector for the parasha Torah text's aliyah
 * boundary markers (issue #2519). All candidate marker layers are
 * already embedded in the text; this control picks the visible
 * `"{reading}:{scheme}"` key and toggles marker visibility in place —
 * scripture never remounts, so scroll position, pasuk selection, and
 * anchors are preserved across switches. The choice mirrors into
 * `?reading=`/`?scheme=` so it is shareable and survives navigation.
 */
export function AliyahControls({
	contexts,
	defaultKey,
}: {
	contexts: UnitAliyahContextOption[];
	/** `"{readingId}:{schemeId}"` shown when the URL carries no choice. */
	defaultKey: string;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const [defaultContext, defaultScheme] = defaultKey.split(":");
	const context =
		contexts.find((c) => c.contextId === searchParams.get("reading")) ??
		contexts.find((c) => c.contextId === defaultContext) ??
		contexts[0];
	const scheme =
		context.schemes.find((s) => s.schemeId === searchParams.get("scheme")) ??
		context.schemes.find((s) => s.schemeId === defaultScheme) ??
		context.schemes[0];
	const selectedKey = `${context.contextId}:${scheme.schemeId}`;

	useEffect(() => {
		for (const el of document.querySelectorAll<HTMLElement>(
			"[data-unit-text] [data-aliyah-marker]",
		)) {
			el.hidden = el.dataset.aliyahKey !== selectedKey;
		}
	}, [selectedKey]);

	const select = useCallback(
		(contextId: string, schemeId: string) => {
			const params = new URLSearchParams(searchParams.toString());
			if (`${contextId}:${schemeId}` === defaultKey) {
				params.delete("reading");
				params.delete("scheme");
			} else {
				params.set("reading", contextId);
				params.set("scheme", schemeId);
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
		},
		[defaultKey, pathname, router, searchParams],
	);

	const contextButtons = useMemo(
		() =>
			contexts.map((option) => (
				<button
					key={option.contextId}
					type="button"
					className={styles.option}
					aria-pressed={option.contextId === context.contextId}
					onClick={() => {
						// Keep the current scheme when the new context offers
						// it; otherwise land on Shabbat — joined contexts have
						// no weekday split, so retaining a missing scheme id
						// could mix layers.
						const next =
							option.schemes.find((s) => s.schemeId === scheme.schemeId) ??
							option.schemes.find((s) => s.schemeId === "shabbat") ??
							option.schemes[0];
						select(option.contextId, next.schemeId);
					}}
				>
					{option.label}
				</button>
			)),
		[contexts, context.contextId, scheme.schemeId, select],
	);

	return (
		<fieldset className={styles.controls}>
			<legend className={styles.srOnly}>חלוקת עליות</legend>
			<span className={styles.group}>
				<span className={styles.groupLabel}>חלוקה:</span>
				{contextButtons}
			</span>
			<span className={styles.group}>
				<span className={styles.groupLabel}>קריאה:</span>
				{context.schemes.map((option) => (
					<button
						key={option.schemeId}
						type="button"
						className={styles.option}
						aria-pressed={option.schemeId === scheme.schemeId}
						onClick={() => select(context.contextId, option.schemeId)}
					>
						{option.label}
					</button>
				))}
			</span>
		</fieldset>
	);
}
