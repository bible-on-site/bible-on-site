import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	type MoedSectionInput,
	type MoedUpsert,
	deleteMoed,
	getMoed,
	listMoadim,
	upsertMoed,
} from "~/server/moadim";

export const Route = createFileRoute("/moadim")({
	component: MoadimPage,
});

/** One editable range row — `rowKey` keeps React keys stable across add/remove. */
interface RangeRow {
	rowKey: number;
	perekIdStart: number;
	pasukStart: number;
	perekIdEnd: number;
	pasukEnd: number;
}

interface SectionRow {
	rowKey: number;
	label: string;
	ranges: RangeRow[];
}

interface FormState {
	id: number | null;
	name: string;
	slug: string;
	summary: string;
	hebrewMonth: string;
	dateLabel: string;
	annualOrder: number;
	published: boolean;
	sections: SectionRow[];
}

const emptyForm = (): FormState => ({
	id: null,
	name: "",
	slug: "",
	summary: "",
	hebrewMonth: "",
	dateLabel: "",
	annualOrder: 1,
	published: false,
	sections: [{ rowKey: 1, label: "", ranges: [emptyRange(2)] }],
});

const emptyRange = (rowKey: number): RangeRow => ({
	rowKey,
	perekIdStart: 1,
	pasukStart: 1,
	perekIdEnd: 1,
	pasukEnd: 1,
});

function MoadimPage() {
	const queryClient = useQueryClient();
	const [form, setForm] = useState<FormState | null>(null);
	const { data: moadim, isLoading } = useQuery({
		queryKey: ["moadim"],
		queryFn: () => listMoadim(),
	});
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: ["moadim"] });

	const upsertMutation = useMutation({
		mutationFn: (input: { id?: number } & MoedUpsert) =>
			upsertMoed({ data: input }),
		onSuccess: () => {
			invalidate();
			setForm(null);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: (id: number) => deleteMoed({ data: id }),
		onSuccess: invalidate,
	});
	const error = upsertMutation.error ?? deleteMutation.error;

	const openEdit = async (moedId: number) => {
		const detail = await getMoed({ data: moedId });
		if (!detail) return;
		let rowKey = 1;
		setForm({
			id: detail.id,
			name: detail.name,
			slug: detail.slug,
			summary: detail.summary ?? "",
			hebrewMonth: detail.hebrewMonth ?? "",
			dateLabel: detail.dateLabel ?? "",
			annualOrder: detail.annualOrder,
			published: detail.published,
			sections: detail.sections.map((section) => ({
				rowKey: rowKey++,
				label: section.label,
				ranges: section.ranges.map((range) => ({
					rowKey: rowKey++,
					...range,
				})),
			})),
		});
	};

	const submit = () => {
		if (!form) return;
		const input = {
			name: form.name,
			slug: form.slug || undefined,
			summary: form.summary || null,
			hebrewMonth: form.hebrewMonth || null,
			dateLabel: form.dateLabel || null,
			annualOrder: form.annualOrder,
			published: form.published,
			sections: form.sections.map(
				({ label, ranges }): MoedSectionInput => ({
					label,
					ranges: ranges.map(
						({ rowKey: _rowKey, ...range }) => range,
					),
				}),
			),
		};
		upsertMutation.mutate(
			form.id == null ? input : { id: form.id, ...input },
		);
	};

	return (
		<div>
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-2xl font-bold">מועדים על הפרק</h1>
				<button
					type="button"
					onClick={() => setForm(emptyForm())}
					className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
				>
					מועד חדש
				</button>
			</div>

			{error && (
				<div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">
					{(error as Error).message}
				</div>
			)}

			{isLoading ? (
				<p className="text-sm text-gray-500">טוען...</p>
			) : moadim === undefined ? (
				<p className="text-sm text-gray-500">סכמת המועדים עוד לא נפרסה</p>
			) : (
				<div className="bg-white rounded-lg shadow overflow-hidden">
					<table className="min-w-full text-sm">
						<thead className="bg-gray-50 text-right">
							<tr>
								<th className="px-4 py-2">מועד</th>
								<th className="px-4 py-2">סלאג</th>
								<th className="px-4 py-2">מיקום שנתי</th>
								<th className="px-4 py-2">סעיפים / טווחים</th>
								<th className="px-4 py-2">מאמרים</th>
								<th className="px-4 py-2">סטטוס</th>
								<th className="px-4 py-2" />
							</tr>
						</thead>
						<tbody>
							{moadim.map((moed) => (
								<tr
									key={moed.id}
									className={`border-t ${moed.published ? "" : "opacity-60"}`}
								>
									<td className="px-4 py-2 font-medium">
										{moed.name}
										{moed.dateLabel && (
											<span className="text-gray-500"> — {moed.dateLabel}</span>
										)}
									</td>
									<td className="px-4 py-2 text-gray-500" dir="ltr">
										{moed.slug}
									</td>
									<td className="px-4 py-2">{moed.annualOrder}</td>
									<td className="px-4 py-2">
										{moed.sectionCount} / {moed.rangeCount}
									</td>
									<td className="px-4 py-2">{moed.articleCount}</td>
									<td className="px-4 py-2">
										{moed.published ? (
											<span className="text-green-700">מפורסם</span>
										) : (
											<span className="text-gray-500">טיוטה</span>
										)}
									</td>
									<td className="px-4 py-2 whitespace-nowrap">
										<button
											type="button"
											onClick={() => void openEdit(moed.id)}
											className="text-blue-600 hover:underline ml-3"
										>
											ערוך
										</button>
										<button
											type="button"
											onClick={() => {
												if (
													window.confirm(`למחוק את המועד "${moed.name}"?`)
												)
													deleteMutation.mutate(moed.id);
											}}
											className="text-red-600 hover:underline"
										>
											מחק
										</button>
									</td>
								</tr>
							))}
							{moadim.length === 0 && (
								<tr>
									<td colSpan={7} className="px-4 py-6 text-center text-gray-500">
										אין מועדים להצגה
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}

			{form && (
				<MoedForm
					form={form}
					setForm={setForm}
					pending={upsertMutation.isPending}
					onSubmit={submit}
				/>
			)}
		</div>
	);
}

function MoedForm({
	form,
	setForm,
	pending,
	onSubmit,
}: {
	form: FormState;
	setForm: (form: FormState | null) => void;
	pending: boolean;
	onSubmit: () => void;
}) {
	const update = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
	const nextRowKey =
		Math.max(
			0,
			...form.sections.flatMap((s) => [
				s.rowKey,
				...s.ranges.map((r) => r.rowKey),
			]),
		) + 1;
	const updateSection = (si: number, patch: Partial<SectionRow>) =>
		update({
			sections: form.sections.map((s, i) =>
				i === si ? { ...s, ...patch } : s,
			),
		});
	const updateRange = (si: number, ri: number, patch: Partial<RangeRow>) =>
		updateSection(si, {
			ranges: form.sections[si].ranges.map((r, i) =>
				i === ri ? { ...r, ...patch } : r,
			),
		});

	return (
		<div className="fixed inset-0 bg-black/40 flex items-start justify-center overflow-y-auto z-50 py-10">
			<div className="bg-white rounded-lg shadow-xl w-full max-w-3xl p-6">
				<h2 className="text-lg font-bold mb-4">
					{form.id == null ? "מועד חדש" : `עריכת ${form.name}`}
				</h2>

				<div className="grid grid-cols-2 gap-4 mb-4">
					<div>
						<label htmlFor="moed-name" className="block text-sm font-medium mb-1">
							שם המועד *
						</label>
						<input
							id="moed-name"
							value={form.name}
							onChange={(e) => update({ name: e.target.value })}
							className="border rounded-lg px-3 py-2 text-sm w-full"
							placeholder="פסח"
						/>
					</div>
					<div>
						<label htmlFor="moed-slug" className="block text-sm font-medium mb-1">
							סלאג (ריק = נגזר מהשם)
						</label>
						<input
							id="moed-slug"
							value={form.slug}
							onChange={(e) => update({ slug: e.target.value })}
							className="border rounded-lg px-3 py-2 text-sm w-full"
							placeholder="פסח"
						/>
					</div>
					<div>
						<label
							htmlFor="moed-order"
							className="block text-sm font-medium mb-1"
						>
							מיקום במעגל השנתי *
						</label>
						<input
							id="moed-order"
							type="number"
							min={1}
							value={form.annualOrder}
							onChange={(e) => update({ annualOrder: Number(e.target.value) })}
							className="border rounded-lg px-3 py-2 text-sm w-full"
						/>
					</div>
					<div>
						<label
							htmlFor="moed-month"
							className="block text-sm font-medium mb-1"
						>
							חודש עברי
						</label>
						<input
							id="moed-month"
							value={form.hebrewMonth}
							onChange={(e) => update({ hebrewMonth: e.target.value })}
							className="border rounded-lg px-3 py-2 text-sm w-full"
							placeholder="ניסן"
						/>
					</div>
					<div>
						<label
							htmlFor="moed-date"
							className="block text-sm font-medium mb-1"
						>
							תווית תאריך
						</label>
						<input
							id="moed-date"
							value={form.dateLabel}
							onChange={(e) => update({ dateLabel: e.target.value })}
							className="border rounded-lg px-3 py-2 text-sm w-full"
							placeholder="טו-כב בניסן"
						/>
					</div>
					<label className="flex items-center gap-2 text-sm font-medium self-end">
						<input
							type="checkbox"
							checked={form.published}
							onChange={(e) => update({ published: e.target.checked })}
						/>
						מפורסם באתר
					</label>
				</div>

				<label htmlFor="moed-summary" className="block text-sm font-medium mb-1">
					תקציר
				</label>
				<textarea
					id="moed-summary"
					value={form.summary}
					onChange={(e) => update({ summary: e.target.value })}
					rows={2}
					className="border rounded-lg px-3 py-2 text-sm w-full mb-4 resize-none"
					placeholder="תיאור קצר של המועד"
				/>

				<div className="flex items-center justify-between mb-2">
					<span className="text-sm font-medium">סעיפי קריאה</span>
					<button
						type="button"
						onClick={() =>
							update({
								sections: [
									...form.sections,
									{
										rowKey: nextRowKey,
										label: "",
										ranges: [emptyRange(nextRowKey + 1)],
									},
								],
							})
						}
						className="text-blue-600 hover:underline text-sm"
					>
						+ הוסף סעיף
					</button>
				</div>
				{form.sections.map((section, si) => (
					<div key={section.rowKey} className="border rounded-lg p-3 mb-3">
						<div className="flex items-center gap-2 mb-2">
							<input
								placeholder="תווית הסעיף (למשל תורה)"
								value={section.label}
								onChange={(e) => updateSection(si, { label: e.target.value })}
								className="border rounded-lg px-2 py-1 text-sm flex-1"
							/>
							<button
								type="button"
								onClick={() =>
									updateSection(si, {
										ranges: [...section.ranges, emptyRange(nextRowKey)],
									})
								}
								className="text-blue-600 hover:underline text-xs"
							>
								+ טווח
							</button>
							<button
								type="button"
								onClick={() =>
									update({
										sections: form.sections.filter((_, i) => i !== si),
									})
								}
								className="text-red-600 hover:underline text-xs"
							>
								הסר סעיף
							</button>
						</div>
						{section.ranges.map((range, ri) => (
							<div
								key={range.rowKey}
								className="flex flex-wrap items-center gap-2 mb-1 text-xs"
							>
								<span>מפרק</span>
								<input
									type="number"
									min={1}
									max={929}
									value={range.perekIdStart}
									onChange={(e) =>
										updateRange(si, ri, {
											perekIdStart: Number(e.target.value),
										})
									}
									className="border rounded px-2 py-1 w-20"
								/>
								<span>פסוק</span>
								<input
									type="number"
									min={1}
									value={range.pasukStart}
									onChange={(e) =>
										updateRange(si, ri, { pasukStart: Number(e.target.value) })
									}
									className="border rounded px-2 py-1 w-16"
								/>
								<span>עד פרק</span>
								<input
									type="number"
									min={1}
									max={929}
									value={range.perekIdEnd}
									onChange={(e) =>
										updateRange(si, ri, {
											perekIdEnd: Number(e.target.value),
										})
									}
									className="border rounded px-2 py-1 w-20"
								/>
								<span>פסוק</span>
								<input
									type="number"
									min={1}
									value={range.pasukEnd}
									onChange={(e) =>
										updateRange(si, ri, { pasukEnd: Number(e.target.value) })
									}
									className="border rounded px-2 py-1 w-16"
								/>
								<button
									type="button"
									onClick={() =>
										updateSection(si, {
											ranges: section.ranges.filter((_, i) => i !== ri),
										})
									}
									className="text-red-600 hover:underline"
								>
									הסר
								</button>
							</div>
						))}
					</div>
				))}
				<p className="text-xs text-gray-400">
					מזהי פרקים הם הקנוניים (1-929). טווח כוללני — כולל פסוק ההתחלה
									והסיום.
				</p>

				<div className="flex justify-end gap-3 mt-6">
					<button
						type="button"
						onClick={() => setForm(null)}
						className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
					>
						ביטול
					</button>
					<button
						type="button"
						onClick={onSubmit}
						disabled={pending || !form.name.trim()}
						className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
					>
						{form.id == null ? "צור" : "שמור"}
					</button>
				</div>
			</div>
		</div>
	);
}
