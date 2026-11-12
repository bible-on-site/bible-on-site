import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	type EntityExternalReference,
	EXTERNAL_REFERENCE_SOURCE_LABELS,
	EXTERNAL_REFERENCE_SOURCES,
	type ExternalReferenceSource,
	externalReferenceDisplayId,
} from "~/lib/tanahpedia/external-references";
import {
	deleteEntityExternalReference,
	upsertEntityExternalReference,
} from "~/server/tanahpedia/external-references";

/**
 * Per-source external-identifier editor for one linked entity (#3330).
 * Rows are keyed by the entity UUID through the server functions; every
 * source keeps a draft input plus the URL snapshot it was loaded with, so
 * a failed save leaves the draft untouched and a stale edit is rejected
 * server-side instead of overwriting a newer mapping.
 */
interface EntityExternalReferencesProps {
	entityId: string;
	references: EntityExternalReference[];
	onSaved: () => void;
}

/** Shared empty draft source — must stay referentially stable for useEffect. */
const NO_REFERENCES: EntityExternalReference[] = [];

type Drafts = Record<ExternalReferenceSource, string>;

function emptyDrafts(): Drafts {
	return {
		WIKIDATA: "",
		WIKIPEDIA_HE: "",
		WIKIPEDIA_EN: "",
		SEFARIA: "",
		OFFICIAL: "",
	};
}

function draftsFor(references: EntityExternalReference[]): Drafts {
	const drafts = emptyDrafts();
	for (const ref of references) drafts[ref.source] = ref.url;
	return drafts;
}

export function EntityExternalReferences({
	entityId,
	references = NO_REFERENCES,
	onSaved,
}: EntityExternalReferencesProps) {
	const [drafts, setDrafts] = useState<Drafts>(() => draftsFor(references));
	const [rowError, setRowError] = useState<{
		source: ExternalReferenceSource;
		message: string;
	} | null>(null);

	// Re-sync drafts only when the stored mapping content actually changed —
	// an unrelated refetch must not clobber an in-progress draft.
	const signature = JSON.stringify(references);
	const lastSignature = useRef(signature);
	useEffect(() => {
		if (signature === lastSignature.current) return;
		lastSignature.current = signature;
		setDrafts(draftsFor(references));
		setRowError(null);
	}, [references, signature]);

	const baseline = new Map(
		references.map((ref) => [ref.source, ref.url] as const),
	);

	const mutSave = useMutation({
		mutationFn: (input: {
			source: ExternalReferenceSource;
			url: string;
			expectedUrl: string | null;
		}) =>
			upsertEntityExternalReference({
				data: { entityId, ...input },
			}),
		onSuccess: () => {
			setRowError(null);
			onSaved();
		},
		onError: (error, input) => {
			setRowError({
				source: input.source,
				message: error instanceof Error ? error.message : String(error),
			});
		},
	});

	const mutRemove = useMutation({
		mutationFn: (input: {
			source: ExternalReferenceSource;
			expectedUrl: string | null;
		}) =>
			deleteEntityExternalReference({
				data: { entityId, ...input },
			}),
		onSuccess: () => {
			setRowError(null);
			onSaved();
		},
		onError: (error, input) => {
			setRowError({
				source: input.source,
				message: error instanceof Error ? error.message : String(error),
			});
		},
	});

	const busy = mutSave.isPending || mutRemove.isPending;

	return (
		<div className="border-t border-gray-100 pt-3 space-y-2">
			<div>
				<span className="block text-sm font-medium text-gray-700">
					מזהים חיצוניים (external_reference)
				</span>
				<p className="text-xs text-gray-500">
					מופיעים כ-sameAs ב-JSON-LD של הערך. ודאו שהקישור מזהה את אותה יישות
					בדיוק.
				</p>
			</div>
			{EXTERNAL_REFERENCE_SOURCES.map((source) => {
				const savedUrl = baseline.get(source) ?? null;
				const draft = drafts[source];
				const dirty = draft.trim() !== "" && draft.trim() !== savedUrl;
				return (
					<div key={source} className="space-y-1">
						<label
							htmlFor={`ext-${entityId}-${source}`}
							className="block text-xs font-medium text-gray-600"
						>
							{EXTERNAL_REFERENCE_SOURCE_LABELS[source]}
						</label>
						<div className="flex gap-2 items-center">
							<input
								id={`ext-${entityId}-${source}`}
								value={draft}
								placeholder={source === "WIKIDATA" ? "QID או קישור" : "קישור"}
								onChange={(e) =>
									setDrafts((prev) => ({
										...prev,
										[source]: e.target.value,
									}))
								}
								className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
								dir="ltr"
							/>
							{savedUrl ? (
								<a
									href={savedUrl}
									target="_blank"
									rel="noreferrer noopener"
									className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
								>
									פתח {externalReferenceDisplayId(source, savedUrl)}
								</a>
							) : null}
							<button
								type="button"
								disabled={busy || !dirty}
								onClick={() =>
									mutSave.mutate({
										source,
										url: draft,
										expectedUrl: savedUrl,
									})
								}
								className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 whitespace-nowrap"
							>
								שמור
							</button>
							{savedUrl ? (
								<button
									type="button"
									disabled={busy}
									onClick={() =>
										mutRemove.mutate({
											source,
											expectedUrl: savedUrl,
										})
									}
									className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50 whitespace-nowrap"
								>
									הסר
								</button>
							) : null}
						</div>
						{rowError?.source === source ? (
							<p role="alert" className="text-xs text-red-600">
								{rowError.message}
							</p>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
