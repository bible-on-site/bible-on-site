"use client";
import type { UnitAliyahContextOption } from "@/data/parasha/parasha-aliyot";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./aliyah-legend.module.css";

/**
 * Legend + emphasis control for the parasha Torah text's inline aliyah
 * boundary markers (issue #3165 — replaces the exclusive
 * context/scheme selector of #2519). Every applicable division layer
 * already renders inline at its canonical coordinate; the legend lists
 * each layer once in its own marker style and clicking an entry
 * emphasizes the matching markers — scripture never remounts, so
 * scroll position, pasuk selection, and anchors are preserved. The
 * choice mirrors into `?reading=`/`?scheme=`/`?variant=`: the same
 * params the replaced selector accepted stay valid inputs, shareable
 * and deep-linkable.
 */
export function AliyahLegend({
	contexts,
	defaultKey,
}: {
	contexts: UnitAliyahContextOption[];
	/** `"{readingId}:{schemeId}"` emphasized when the URL carries no choice. */
	defaultKey: string;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [isInteractive, setInteractive] = useState(false);
	useEffect(() => {
		setInteractive(true);
	}, []);

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
		scheme.variants.find((v) => v.variantId === searchParams.get("variant")) ??
		null;
	const urlSelection = {
		contextId: context.contextId,
		schemeId: scheme.schemeId,
		variantId: urlVariant?.variantId ?? null,
	};
	const urlContextId = urlSelection.contextId;
	const urlSchemeId = urlSelection.schemeId;
	const urlVariantId = urlSelection.variantId;

	// The emphasized layer is local state seeded from the URL: the swap
	// is instant and does not depend on the soft-navigation commit
	// landing (dev servers may never apply it), while committed
	// navigations — deep links, back/forward — resync below.
	const [selection, setSelection] = useState(urlSelection);
	const appliedUrlSelection = useRef(urlSelection);
	useEffect(() => {
		// State already contains the initial URL selection. Hydration can replay
		// a click before this effect, so only a changed URL may replace it.
		const previous = appliedUrlSelection.current;
		if (
			previous.contextId === urlContextId &&
			previous.schemeId === urlSchemeId &&
			previous.variantId === urlVariantId
		) {
			return;
		}
		const next = {
			contextId: urlContextId,
			schemeId: urlSchemeId,
			variantId: urlVariantId,
		};
		appliedUrlSelection.current = next;
		setSelection(next);
	}, [urlContextId, urlSchemeId, urlVariantId]);

	const selectedKey = selection.variantId
		? `${selection.contextId}:${selection.schemeId}:${selection.variantId}`
		: `${selection.contextId}:${selection.schemeId}`;

	useEffect(() => {
		// Emphasize the chosen layer everywhere markers render — the flat
		// article and the book's Torah spreads share the same contract.
		for (const el of document.querySelectorAll<HTMLElement>(
			"[data-aliyah-marker]",
		)) {
			// A merged marker carries every constituent layer key
			// space-separated — selecting any of them emphasizes it.
			el.toggleAttribute(
				"data-aliyah-selected",
				(el.dataset.aliyahKey ?? "").split(" ").includes(selectedKey),
			);
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

	// One entry per rendered layer — every context's schemes plus each
	// scheme's variants — labeled and styled like their text markers so
	// the legend doubles as the markers' key.
	const entries = useMemo(
		() =>
			contexts.flatMap((context) =>
				context.schemes.flatMap((scheme) => [
					{
						key: `${context.contextId}:${scheme.schemeId}`,
						label: context.kind === "joined" ? context.label : scheme.label,
						category: context.kind === "joined" ? "joined" : scheme.schemeId,
						title: `${context.label} · ${scheme.label}`,
						select: () => select(context.contextId, scheme.schemeId),
					},
					...scheme.variants.map((variant) => ({
						key: `${context.contextId}:${scheme.schemeId}:${variant.variantId}`,
						label: variant.label,
						category: "variant",
						title: `${context.label} · ${scheme.label} · ${variant.label}`,
						select: () =>
							select(context.contextId, scheme.schemeId, variant.variantId),
					})),
				]),
			),
		[contexts, select],
	);

	// Entries reflect the ACTIVE selection — the URL may lag behind it
	// until the soft navigation commits.
	return (
		<fieldset className={styles.legend} disabled={!isInteractive}>
			<legend className={styles.srOnly}>חלוקות העליות בטקסט</legend>
			<span className={styles.groupLabel}>עליות בטקסט:</span>
			{entries.map((entry) => (
				<button
					key={entry.key}
					type="button"
					className={styles.entry}
					data-aliyah-category={entry.category}
					aria-pressed={entry.key === selectedKey}
					title={entry.title}
					onClick={entry.select}
				>
					{entry.label}
				</button>
			))}
		</fieldset>
	);
}
