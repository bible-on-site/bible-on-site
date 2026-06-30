import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
	suggestTanahpediaEntryEdits,
	type TanahpediaLlmProposal,
} from "~/server/tanahpedia/llm-assistant";
import {
	getEntryStructuralContext,
	replacePlaceIdentifications,
	updateEntityDisplayName,
	updatePersonMainName,
	updatePersonSex,
} from "~/server/tanahpedia/structural";

const structuralQueryKey = (entryId: string) =>
	["tanahpedia-entry-structural", entryId] as const;

interface EntryFormSlice {
	title: string;
	unique_name: string;
	content: string;
}

interface TanahpediaLlmAssistantPanelProps {
	entryId: string;
	formData: EntryFormSlice;
	onApplyEntryFields: (patch: Partial<EntryFormSlice>) => void;
}

export function TanahpediaLlmAssistantPanel({
	entryId,
	formData,
	onApplyEntryFields,
}: TanahpediaLlmAssistantPanelProps) {
	const queryClient = useQueryClient();
	const [instruction, setInstruction] = useState("");
	const [lastProposal, setLastProposal] =
		useState<TanahpediaLlmProposal | null>(null);
	const [lastRaw, setLastRaw] = useState<string | null>(null);
	const [showHtmlContext, setShowHtmlContext] = useState(false);

	const suggestMutation = useMutation({
		mutationFn: () =>
			suggestTanahpediaEntryEdits({
				data: {
					entryId,
					userInstruction: instruction,
					draftContentHtml: formData.content,
					draftTitle: formData.title,
					draftUniqueName: formData.unique_name,
				},
			}),
		onSuccess: (res) => {
			setLastProposal(res.proposal);
			setLastRaw(res.rawJson);
		},
	});

	const applyMutation = useMutation({
		mutationFn: async (proposal: TanahpediaLlmProposal) => {
			if (proposal.entry) {
				onApplyEntryFields({
					...(proposal.entry.title !== undefined
						? { title: proposal.entry.title }
						: {}),
					...(proposal.entry.unique_name !== undefined
						? { unique_name: proposal.entry.unique_name }
						: {}),
					...(proposal.entry.contentHtml !== undefined
						? { content: proposal.entry.contentHtml }
						: {}),
				});
			}
			const linked = proposal.linkedEntities ?? [];
			let structural =
				linked.length > 0
					? await getEntryStructuralContext({ data: entryId })
					: null;
			for (const le of linked) {
				if (!structural) break;
				if (le.displayName !== undefined) {
					await updateEntityDisplayName({
						data: { entityId: le.entityId, name: le.displayName },
					});
				}
				if (le.person?.mainName !== undefined) {
					const row = structural.linkedEntities.find(
						(e) => e.entityId === le.entityId,
					);
					if (row?.person) {
						await updatePersonMainName({
							data: {
								personId: row.person.personId,
								name: le.person.mainName,
								mainNameRowId: row.person.mainNameRowId,
							},
						});
					}
				}
				if (le.person?.sex !== undefined) {
					const row = structural.linkedEntities.find(
						(e) => e.entityId === le.entityId,
					);
					if (row?.person) {
						await updatePersonSex({
							data: {
								personId: row.person.personId,
								sex: le.person.sex,
								sexRowId: row.person.sexRowId,
							},
						});
					}
				}
				if (le.place?.identifications !== undefined) {
					const row = structural.linkedEntities.find(
						(e) => e.entityId === le.entityId,
					);
					if (row?.place) {
						await replacePlaceIdentifications({
							data: {
								placeId: row.place.placeId,
								rows: le.place.identifications.map((r) => ({
									id: r.id,
									modern_name: r.modern_name ?? null,
									latitude: r.latitude ?? null,
									longitude: r.longitude ?? null,
								})),
							},
						});
					}
				}
				structural = await getEntryStructuralContext({ data: entryId });
			}
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: structuralQueryKey(entryId),
			});
		},
	});

	const invalidateStructural = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: structuralQueryKey(entryId),
		});
	}, [queryClient, entryId]);

	return (
		<div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-5 space-y-4">
			<div>
				<h2 className="text-sm font-bold text-indigo-950 mb-1">
					עוזר LLM (הצעות בלבד)
				</h2>
				<p className="text-sm text-indigo-900/85 leading-relaxed">
					המודל מקבל את תוכן ה־HTML, פירוט היישויות המקושרות ותקציר סכמת ה־DB.
					הפלט הוא JSON לאישור — אין גישה ישירה של המודל למסד הנתונים.
				</p>
			</div>

			<div>
				<button
					type="button"
					onClick={() => setShowHtmlContext((v) => !v)}
					className="text-sm text-indigo-700 underline mb-2"
				>
					{showHtmlContext ? "הסתר" : "הצג"} מקור HTML הנשלח להקשר (כמו בעורך)
				</button>
				{showHtmlContext && (
					<pre
						className="text-xs bg-white border border-indigo-100 rounded-lg p-3 max-h-48 overflow-auto whitespace-pre-wrap break-all"
						dir="ltr"
					>
						{formData.content || "(ריק)"}
					</pre>
				)}
			</div>

			<div>
				<label
					htmlFor="llm-instruction"
					className="block text-sm font-medium text-indigo-950 mb-1"
				>
					הנחיה לעורך
				</label>
				<textarea
					id="llm-instruction"
					value={instruction}
					onChange={(e) => setInstruction(e.target.value)}
					rows={4}
					className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm"
					placeholder="למשל: לנסח מחדש את הפסקה הראשונה בעברית מודרנית, לשמור על קישורים פנימיים..."
				/>
			</div>

			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					disabled={suggestMutation.isPending || !instruction.trim()}
					onClick={() => suggestMutation.mutate()}
					className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
				>
					{suggestMutation.isPending ? "שולח..." : "בקש הצעה"}
				</button>
				{lastProposal && (
					<button
						type="button"
						disabled={applyMutation.isPending}
						onClick={() => applyMutation.mutate(lastProposal)}
						className="px-4 py-2 bg-white border border-indigo-300 text-indigo-800 rounded-lg text-sm font-medium disabled:opacity-50"
					>
						{applyMutation.isPending ? "מחיל..." : "החל הצעה על הטפסים והמבנה"}
					</button>
				)}
			</div>

			{suggestMutation.isError && (
				<p className="text-sm text-red-700">
					{suggestMutation.error instanceof Error
						? suggestMutation.error.message
						: String(suggestMutation.error)}
				</p>
			)}

			{applyMutation.isError && (
				<p className="text-sm text-red-700">
					{applyMutation.error instanceof Error
						? applyMutation.error.message
						: String(applyMutation.error)}
				</p>
			)}

			{lastProposal?.notesForEditor && (
				<p className="text-sm text-indigo-900 bg-white/80 rounded-lg p-3 border border-indigo-100">
					<strong>הערות המודל:</strong> {lastProposal.notesForEditor}
				</p>
			)}

			{lastRaw && (
				<details className="text-xs">
					<summary className="cursor-pointer text-indigo-800 font-medium">
						JSON גולמי
					</summary>
					<pre
						className="mt-2 bg-white border rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap break-all"
						dir="ltr"
					>
						{lastRaw}
					</pre>
				</details>
			)}

			<button
				type="button"
				onClick={invalidateStructural}
				className="text-xs text-indigo-600 underline"
			>
				רענן מטמון מבנה יישויות
			</button>
		</div>
	);
}
