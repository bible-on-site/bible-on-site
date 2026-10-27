"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UnitAliyahContextOption } from "@/data/parasha/parasha-aliyot";
import styles from "./aliyah-controls.module.css";

/**
 * Reading-context + scheme/variant selector for the parasha Torah
 * text's aliyah boundary markers (issue #2519). All candidate marker
 * layers are already embedded in the text; this control picks the
 * visible `"{reading}:{scheme}[:{variant}]"` key and toggles marker
 * visibility in place — scripture never remounts, so scroll position,
 * pasuk selection, and anchors are preserved across switches. The
 * choice mirrors into `?reading=`/`?scheme=`/`?variant=` so it is
 * shareable and survives navigation.
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
	// A variant belongs to one scheme of one context — a stale
	// ?variant= that the current scheme never offered is ignored.
	const urlVariant =
		scheme.variants.find(
			(v) => v.variantId === searchParams.get("variant"),
		) ?? null;
	const urlSelection = {
		contextId: context.contextId,
		schemeId: scheme.schemeId,
		variantId: urlVariant?.variantId ?? null,
	};
	const urlContextId = urlSelection.contextId;
	const urlSchemeId = urlSelection.schemeId;
	const urlVariantId = urlSelection.variantId;

	// The visible layer is local state seeded from the URL: the swap is
	// instant and does not depend on the soft-navigation commit landing
	// (dev servers may never apply it), while committed navigations —
	// deep links, back/forward — resync the selection below.
	const [selection, setSelection] = useState(urlSelection);
	useEffect(() => {
		setSelection({
			contextId: urlContextId,
			schemeId: urlSchemeId,
			variantId: urlVariantId,
		});
	}, [urlContextId, urlSchemeId, urlVariantId]);

	const selectedKey = selection.variantId
		? `${selection.contextId}:${selection.schemeId}:${selection.variantId}`
		: `${selection.contextId}:${selection.schemeId}`;

	useEffect(() => {
		for (const el of document.querySelectorAll<HTMLElement>(
			"[data-unit-text] [data-aliyah-marker]",
		)) {
			el.hidden = el.dataset.aliyahKey !== selectedKey;
		}
	}, [selectedKey]);

	const select = useCallback(
		(contextId: string, schemeId: string, variantId?: string) => {
			setSelection({ contextId, schemeId, variantId: variantId ?? null });
			const params = new URLSearchParams(searchParams.toString());
			if (`${contextId}:${schemeId}` === defaultKey) {
				params.delete("reading");
				params.delete("scheme");
			} else {
				params.set("reading", contextId);
				params.set("scheme", schemeId);
			}
			if (variantId) {
				params.set("variant", variantId);
			} else {
				params.delete("variant");
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
					aria-pressed={option.contextId === selection.contextId}
					onClick={() => {
						// Keep the current scheme when the new context offers
						// it; otherwise land on Shabbat — joined contexts have
						// no weekday split, so retaining a missing scheme id
						// could mix layers. Variants never carry across a
						// context or scheme switch: each variant exists inside
						// exactly one scheme of one context.
						const next =
							option.schemes.find(
								(s) => s.schemeId === selection.schemeId,
							) ??
							option.schemes.find((s) => s.schemeId === "shabbat") ??
							option.schemes[0];
						select(option.contextId, next.schemeId);
					}}
				>
					{option.label}
				</button>
			)),
		[contexts, selection.contextId, selection.schemeId, select],
	);

	// Buttons reflect the ACTIVE selection — the URL may lag behind it
	// until the soft navigation commits.
	const offeredContext = contexts.find(
		(c) => c.contextId === selection.contextId,
	);
	/* istanbul ignore next -- selection only ever holds an offered context id */
	const activeContext = offeredContext ?? context;
	const offeredScheme = activeContext.schemes.find(
		(s) => s.schemeId === selection.schemeId,
	);
	/* istanbul ignore next -- selection only ever holds an offered scheme id */
	const activeScheme = offeredScheme ?? scheme;

	return (
		<fieldset className={styles.controls}>
			<legend className={styles.srOnly}>חלוקת עליות</legend>
			<span className={styles.group}>
				<span className={styles.groupLabel}>חלוקה:</span>
				{contextButtons}
			</span>
			<span className={styles.group}>
				<span className={styles.groupLabel}>קריאה:</span>
				{activeContext.schemes.map((option) => (
					<button
						key={option.schemeId}
						type="button"
						className={styles.option}
						aria-pressed={option.schemeId === selection.schemeId}
						onClick={() => select(selection.contextId, option.schemeId)}
					>
						{option.label}
					</button>
				))}
			</span>
			{activeScheme.variants.length > 0 && (
				<span className={styles.group}>
					<span className={styles.groupLabel}>מנהג:</span>
					<button
						type="button"
						className={styles.option}
						aria-pressed={selection.variantId == null}
						onClick={() =>
							select(selection.contextId, selection.schemeId)
						}
					>
						נפוץ
					</button>
					{activeScheme.variants.map((option) => (
						<button
							key={option.variantId}
							type="button"
							className={styles.option}
							aria-pressed={selection.variantId === option.variantId}
							onClick={() =>
								select(
									selection.contextId,
									selection.schemeId,
									option.variantId,
								)
							}
						>
							{option.label}
						</button>
					))}
				</span>
			)}
		</fieldset>
	);
}
