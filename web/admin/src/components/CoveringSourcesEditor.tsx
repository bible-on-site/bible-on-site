import {
	coveringSourceKey,
	duplicateCoveringSourceKeys,
	perekSourceLabel,
	summarizeCoverage,
} from "~/lib/covering-sources";
import type { CoveringSource } from "~/server/covering-sources";
import type { Perek } from "~/server/perakim";

interface CoveringSourcesEditorProps {
	/** Current covering sources (draft state). */
	sources: CoveringSource[];
	/** Whether the current set is marked verified. */
	verified: boolean;
	/** Perakim for the picker; carries each perek's canonical pasuk_count bound. */
	perakim: Perek[];
	/** Perek id used for newly added rows (the article's primary perek). */
	defaultPerekId: number;
	onChange: (sources: CoveringSource[]) => void;
	onVerifiedChange: (verified: boolean) => void;
}

/**
 * Verse-level coverage editor for one article (#2189 / epic #2175 §3).
 * Authors map each pasuk the article verifiably covers; the set may span
 * several perakim. Rows are kept in canonical order, duplicate coordinates
 * are flagged inline, and the verified flag stays separate from row editing
 * so a draft mapping can be saved before it is reviewed.
 */
export function CoveringSourcesEditor({
	sources,
	verified,
	onChange,
	onVerifiedChange,
	perakim,
	defaultPerekId,
}: CoveringSourcesEditorProps) {
	const perekById = new Map(perakim.map((perek) => [perek.id, perek]));
	const duplicates = duplicateCoveringSourceKeys(sources);
	const summary = summarizeCoverage(sources);

	// Rows keep authored order while editing (persisted order is canonical
	// anyway — read-backs and the save payload sort by coordinate).
	const update = (next: CoveringSource[]) => {
		onChange(next);
	};

	const updateRow = (index: number, patch: Partial<CoveringSource>) => {
		update(
			sources.map((row, rowIndex) =>
				rowIndex === index ? { ...row, ...patch } : row,
			),
		);
	};

	// Rows keep authored order while editing (persisted order is canonical
	// anyway — read-backs and the save payload sort by coordinate). They are
	// never reordered (append + delete only) and every input is controlled, so
	// positional keys are correct: a coordinate-derived key would remount the
	// row on every keystroke and drop focus mid-typing.
	const sourceRows = sources.map((source, index) => {
		const perek = perekById.get(source.perek_id);
		const isDuplicate = duplicates.has(coveringSourceKey(source));
		return (
			<div
				key={
					// biome-ignore lint/suspicious/noArrayIndexKey: see above
					index
				}
				className={`flex items-center gap-3 rounded-lg border p-3 ${
					isDuplicate
						? "border-red-300 bg-red-50"
						: "border-gray-200 bg-gray-50"
				}`}
			>
				<select
					aria-label={`פרק למקור ${index + 1}`}
					value={source.perek_id}
					onChange={(e) =>
						updateRow(index, {
							perek_id: Number.parseInt(e.target.value, 10),
						})
					}
					className="flex-1 border border-gray-300 rounded-lg px-3 py-2 bg-white text-sm"
				>
					{perakim.map((option) => (
						<option key={option.id} value={option.id}>
							{perekSourceLabel(option)}
						</option>
					))}
				</select>
				<label className="flex items-center gap-2 text-sm text-gray-600">
					<span>פסוק</span>
					<input
						type="number"
						min={1}
						max={perek?.pasuk_count ?? undefined}
						aria-label={`פסוק למקור ${index + 1}`}
						value={source.pasuk}
						onChange={(e) =>
							updateRow(index, {
								pasuk: Number.parseInt(e.target.value, 10) || 0,
							})
						}
						className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm"
					/>
				</label>
				{perek?.pasuk_count != null && (
					<span className="text-xs text-gray-400">1-{perek.pasuk_count}</span>
				)}
				<button
					type="button"
					aria-label={`הסר מקור ${index + 1}`}
					onClick={() =>
						update(sources.filter((_, rowIndex) => rowIndex !== index))
					}
					className="text-red-600 hover:text-red-700 px-2 py-1 text-sm"
				>
					🗑️
				</button>
			</div>
		);
	});

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<span className="block text-sm font-semibold text-gray-700">
					🎯 כיסוי פסוקים
				</span>
				<span className="text-xs text-gray-500">
					{sources.length === 0
						? "כיסוי לא ידוע — המאמר משויך לפרק הראשי בלבד"
						: `${summary.pasukCount} פסוקים ב-${summary.perekCount} פרקים`}
				</span>
			</div>
			<p className="text-xs text-gray-500">
				מיפוי הפסוקים שהמאמר מכסה בפועל. סימון "כיסוי מאומת" מפעיל חיפוש כיסוי
				ברמת פסוק למסורה ולפרשה; ללא סימון המאמר ממשיך להשתייך לפרק הראשי בלבד.
			</p>

			{sourceRows}

			{duplicates.size > 0 && (
				<p className="text-xs text-red-600">
					קיימים מקורות כפולים — יש להסיר כפילויות לפני השמירה
				</p>
			)}

			<button
				type="button"
				onClick={() =>
					update([...sources, { perek_id: defaultPerekId, pasuk: 1 }])
				}
				className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium"
			>
				<span>+</span>
				<span>הוסף פסוק מכוסה</span>
			</button>

			<label className="flex items-center gap-3 text-sm font-semibold text-gray-700">
				<input
					type="checkbox"
					checked={verified}
					disabled={sources.length === 0}
					onChange={(e) => onVerifiedChange(e.target.checked)}
				/>
				כיסוי מאומת
			</label>
			{verified && sources.length === 0 && (
				<p className="text-xs text-red-600">
					כיסוי מאומת דורש לפחות פסוק מכוסה אחד
				</p>
			)}
		</div>
	);
}
