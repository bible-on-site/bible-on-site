import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
	type AdminDedication,
	type DedicationTargetInput,
	type DedicationTargetKind,
	type DedicationUpsert,
	createDedication,
	deleteDedication,
	getDedicationTargetOptions,
	getDedicationTypes,
	listDedications,
	updateDedication,
} from "~/server/dedications";

export const Route = createFileRoute("/dedications")({
	component: DedicationsPage,
});

/** Mirrors the public formatDedication line (#2731) — kept client-side. */
function previewLine(subject: string, purposes: string[]): string {
	const clean = purposes.filter((p) => p.trim().length > 0);
	return clean.length === 0 ? `מוקדש ל${subject}` : `מוקדש ל${subject} (${clean.join(", ")})`;
}

const KIND_LABELS: Record<DedicationTargetKind, string> = {
	perek: "טווח פרקים",
	sefer: "ספר שלם",
	helek: "חלק שלם",
	parasha: "פרשה שבועית",
	article: "מאמר",
	entry: "ערך תנכפדיה",
	masora: "מסורה על הפרק",
};

const KIND_ORDER: DedicationTargetKind[] = ["perek", "sefer", "helek", "parasha", "article", "entry", "masora"];

/** A target row in the form — `rowKey` keeps React keys stable across add/remove. */
type TargetRow = DedicationTargetInput & { rowKey: number };

interface FormState {
	id: number | null;
	subject: string;
	purposeTypeIds: number[];
	/** "YYYY-MM-DDTHH:mm" entered as UTC. */
	expiresAt: string;
	targets: TargetRow[];
}

const emptyForm = (): FormState => ({ id: null, subject: "", purposeTypeIds: [], expiresAt: "", targets: [] });

/** datetime-local input value <-> stored UTC "YYYY-MM-DD HH:mm:ss". */
const toStoredExpiry = (value: string) => (value ? `${value.replace("T", " ")}:00` : null);
const toInputExpiry = (value: string | null) => (value ? value.replace(" ", "T").slice(0, 16) : "");

function DedicationsPage() {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [show, setShow] = useState<"active" | "expired" | "all">("active");
	const [form, setForm] = useState<FormState | null>(null);

	const { data: dedications, isLoading } = useQuery({
		queryKey: ["dedications", search, show],
		queryFn: () => listDedications({ data: { search, show } }),
	});
	const { data: types } = useQuery({ queryKey: ["dedication-types"], queryFn: () => getDedicationTypes() });
	const { data: targetOptions } = useQuery({
		queryKey: ["dedication-target-options"],
		queryFn: () => getDedicationTargetOptions(),
	});

	const invalidate = () => queryClient.invalidateQueries({ queryKey: ["dedications"] });
	const createMutation = useMutation({
		mutationFn: (input: DedicationUpsert) => createDedication({ data: input }),
		onSuccess: () => {
			invalidate();
			setForm(null);
		},
	});
	const updateMutation = useMutation({
		mutationFn: (input: { id: number } & DedicationUpsert) => updateDedication({ data: input }),
		onSuccess: () => {
			invalidate();
			setForm(null);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: (id: number) => deleteDedication({ data: id }),
		onSuccess: invalidate,
	});
	const error = createMutation.error ?? updateMutation.error ?? deleteMutation.error;

	const openEdit = (d: AdminDedication) =>
		setForm({
			id: d.id,
			subject: d.subject,
			purposeTypeIds:
				types?.filter((t) => d.purposes.includes(t.description)).map((t) => t.id) ?? [],
			expiresAt: toInputExpiry(d.expiresAt),
			targets: targetsToInputs(d),
		});

	const submit = () => {
		if (!form) return;
		const input: DedicationUpsert = {
			subject: form.subject,
			purposeTypeIds: form.purposeTypeIds,
			expiresAt: toStoredExpiry(form.expiresAt),
			targets: form.targets.map(({ rowKey: _rowKey, ...target }) => target),
		};
		if (form.id == null) createMutation.mutate(input);
		else updateMutation.mutate({ id: form.id, ...input });
	};

	return (
		<div>
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-2xl font-bold">הקדשות</h1>
				<button
					type="button"
					onClick={() => setForm(emptyForm())}
					className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
				>
					הקדשה חדשה
				</button>
			</div>

			<div className="flex gap-3 mb-4">
				<input
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="חיפוש לפי שם המוקדש..."
					className="border rounded-lg px-3 py-2 text-sm w-72"
				/>
				<select
					value={show}
					onChange={(e) => setShow(e.target.value as typeof show)}
					className="border rounded-lg px-3 py-2 text-sm"
				>
					<option value="active">פעילות</option>
					<option value="expired">שפג תוקפן</option>
					<option value="all">הכול</option>
				</select>
			</div>

			{error && (
				<div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">
					{(error as Error).message}
				</div>
			)}

			{isLoading ? (
				<p className="text-sm text-gray-500">טוען...</p>
			) : (
				<div className="bg-white rounded-lg shadow overflow-hidden">
					<table className="min-w-full text-sm">
						<thead className="bg-gray-50 text-right">
							<tr>
								<th className="px-4 py-2">מוקדש ל</th>
								<th className="px-4 py-2">מטרות</th>
								<th className="px-4 py-2">יעדים</th>
								<th className="px-4 py-2">תוקף (UTC)</th>
								<th className="px-4 py-2" />
							</tr>
						</thead>
						<tbody>
							{(dedications ?? []).map((d) => (
								<tr key={d.id} className={`border-t ${d.expired ? "opacity-60" : ""}`}>
									<td className="px-4 py-2 font-medium">{previewLine(d.subject, d.purposes)}</td>
									<td className="px-4 py-2">{d.purposes.join(", ")}</td>
									<td className="px-4 py-2">
										{d.targets.map((t, i) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
											<div key={i}>
												{KIND_LABELS[t.kind]}: {t.label}
												{t.expiresAt ? ` (עד ${t.expiresAt} UTC)` : ""}
											</div>
										))}
									</td>
									<td className="px-4 py-2">
										{d.expiresAt ?? "מתמשך"}
										{d.expired ? " (פג)" : ""}
									</td>
									<td className="px-4 py-2 whitespace-nowrap">
										<button type="button" onClick={() => openEdit(d)} className="text-blue-600 hover:underline ml-3">
											ערוך
										</button>
										<button
											type="button"
											onClick={() => {
												if (window.confirm(`למחוק את ההקדשה "${d.subject}"?`)) deleteMutation.mutate(d.id);
											}}
											className="text-red-600 hover:underline"
										>
											מחק
										</button>
									</td>
								</tr>
							))}
							{(dedications ?? []).length === 0 && (
								<tr>
									<td colSpan={5} className="px-4 py-6 text-center text-gray-500">
										אין הקדשות להצגה
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}

			{form && (
				<DedicationForm
					form={form}
					setForm={setForm}
					types={types ?? []}
					sefarim={targetOptions?.sefarim ?? []}
					heleks={targetOptions?.heleks ?? []}
					parashaCount={targetOptions?.parashaCount ?? 54}
					pending={createMutation.isPending || updateMutation.isPending}
					onSubmit={submit}
				/>
			)}
		</div>
	);
}

/** Maps the labelled targets back to editable input rows — raw ids ride along. */
function targetsToInputs(d: AdminDedication): TargetRow[] {
	return d.targets.map((t, i) => ({
		rowKey: i,
		kind: t.kind,
		expiresAt: t.expiresAt,
		perekIdLow: t.perekIdLow,
		perekIdHigh: t.perekIdHigh,
		seferId: t.seferId,
		helekId: t.helekId,
		parashaId: t.parashaId,
		articleId: t.articleId,
		entryId: t.entryId,
	}));
}

function DedicationForm({
	form,
	setForm,
	types,
	sefarim,
	heleks,
	parashaCount,
	pending,
	onSubmit,
}: {
	form: FormState;
	setForm: (form: FormState | null) => void;
	types: { id: number; description: string }[];
	sefarim: { id: number; name: string }[];
	heleks: { id: number; name: string }[];
	parashaCount: number;
	pending: boolean;
	onSubmit: () => void;
}) {
	const selectedPurposeNames = useMemo(
		() => types.filter((t) => form.purposeTypeIds.includes(t.id)).map((t) => t.description),
		[types, form.purposeTypeIds],
	);
	const update = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
	const updateTarget = (index: number, patch: Partial<TargetRow>) =>
		update({ targets: form.targets.map((t, i) => (i === index ? { ...t, ...patch } : t)) });
	const nextRowKey = Math.max(0, ...form.targets.map((t) => t.rowKey)) + 1;

	return (
		<div className="fixed inset-0 bg-black/40 flex items-start justify-center overflow-y-auto z-50 py-10">
			<div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6">
				<h2 className="text-lg font-bold mb-4">{form.id == null ? "הקדשה חדשה" : `עריכת הקדשה #${form.id}`}</h2>

				<label htmlFor="dedication-subject" className="block text-sm font-medium mb-1">
					מוקדש ל
				</label>
				<input
					id="dedication-subject"
					value={form.subject}
					onChange={(e) => update({ subject: e.target.value })}
					className="border rounded-lg px-3 py-2 text-sm w-full mb-4"
					placeholder="מרדכי בן זאב"
				/>

				<div className="block text-sm font-medium mb-1">מטרות</div>
				<div className="flex flex-wrap gap-3 mb-4">
					{types.map((t) => (
						<label key={t.id} className="flex items-center gap-1 text-sm">
							<input
								type="checkbox"
								checked={form.purposeTypeIds.includes(t.id)}
								onChange={(e) =>
									update({
										purposeTypeIds: e.target.checked
											? [...form.purposeTypeIds, t.id]
											: form.purposeTypeIds.filter((id) => id !== t.id),
									})
								}
							/>
							{t.description}
						</label>
					))}
				</div>

				<label htmlFor="dedication-expiry" className="block text-sm font-medium mb-1">
					תוקף ההקדשה (UTC, ריק = מתמשך)
				</label>
				<input
					id="dedication-expiry"
					type="datetime-local"
					value={form.expiresAt}
					onChange={(e) => update({ expiresAt: e.target.value })}
					className="border rounded-lg px-3 py-2 text-sm mb-4"
				/>

				<div className="flex items-center justify-between mb-2">
					<span className="text-sm font-medium">יעדים</span>
					<button
						type="button"
						onClick={() => update({ targets: [...form.targets, { rowKey: nextRowKey, kind: "sefer", seferId: 1 }] })}
						className="text-blue-600 hover:underline text-sm"
					>
						+ הוסף יעד
					</button>
				</div>
				{form.targets.map((target, index) => (
					<div key={target.rowKey} className="border rounded-lg p-3 mb-2 flex flex-wrap items-center gap-2">
						<select
							value={target.kind}
							onChange={(e) =>
								updateTarget(index, { kind: e.target.value as DedicationTargetKind, seferId: e.target.value === "sefer" ? 1 : undefined })
							}
							className="border rounded-lg px-2 py-1 text-sm"
						>
							{KIND_ORDER.map((kind) => (
								<option key={kind} value={kind}>
									{KIND_LABELS[kind]}
								</option>
							))}
						</select>

						{target.kind === "perek" && (
							<>
								<input
									type="number"
									placeholder="מפרק"
									value={target.perekIdLow ?? ""}
									onChange={(e) => updateTarget(index, { perekIdLow: Number(e.target.value) })}
									className="border rounded-lg px-2 py-1 text-sm w-24"
								/>
								<input
									type="number"
									placeholder="עד פרק"
									value={target.perekIdHigh ?? ""}
									onChange={(e) => updateTarget(index, { perekIdHigh: Number(e.target.value) })}
									className="border rounded-lg px-2 py-1 text-sm w-24"
								/>
							</>
						)}
						{target.kind === "sefer" && (
							<select
								value={target.seferId ?? 1}
								onChange={(e) => updateTarget(index, { seferId: Number(e.target.value) })}
								className="border rounded-lg px-2 py-1 text-sm"
							>
								{sefarim.map((s) => (
									<option key={s.id} value={s.id}>
										{s.name}
									</option>
								))}
							</select>
						)}
						{target.kind === "helek" && (
							<select
								value={target.helekId ?? 1}
								onChange={(e) => updateTarget(index, { helekId: Number(e.target.value) })}
								className="border rounded-lg px-2 py-1 text-sm"
							>
								{heleks.map((h) => (
									<option key={h.id} value={h.id}>
										{h.name}
									</option>
								))}
							</select>
						)}
						{target.kind === "parasha" && (
							<input
								type="number"
								min={1}
								max={parashaCount}
								placeholder={`1-${parashaCount}`}
								value={target.parashaId ?? ""}
								onChange={(e) => updateTarget(index, { parashaId: Number(e.target.value) })}
								className="border rounded-lg px-2 py-1 text-sm w-24"
							/>
						)}
						{target.kind === "article" && (
							<input
								type="number"
								placeholder="מזהה מאמר"
								value={target.articleId ?? ""}
								onChange={(e) => updateTarget(index, { articleId: Number(e.target.value) })}
								className="border rounded-lg px-2 py-1 text-sm w-32"
							/>
						)}
						{target.kind === "entry" && (
							<input
								placeholder="מזהה ערך קנוני"
								value={target.entryId ?? ""}
								onChange={(e) => updateTarget(index, { entryId: e.target.value })}
								className="border rounded-lg px-2 py-1 text-sm w-56"
							/>
						)}
						{target.kind === "masora" && <span className="text-sm text-gray-500">כל יחידות המסורה</span>}

						<label className="text-xs text-gray-500 flex items-center gap-1">
							תוקף יעד (UTC):
							<input
								type="datetime-local"
								value={toInputExpiry(target.expiresAt ?? null)}
								onChange={(e) => updateTarget(index, { expiresAt: toStoredExpiry(e.target.value) })}
								className="border rounded-lg px-2 py-1 text-xs"
							/>
						</label>
						<button
							type="button"
							onClick={() => update({ targets: form.targets.filter((_, i) => i !== index) })}
							className="text-red-600 hover:underline text-xs"
						>
							הסר
						</button>
					</div>
				))}

				<div className="mt-4 rounded-lg bg-gray-50 border px-3 py-2 text-sm">
					<span className="text-gray-500">תצוגה מקדימה: </span>
					{previewLine(form.subject || "...", selectedPurposeNames)}
				</div>

				<div className="flex justify-end gap-3 mt-6">
					<button type="button" onClick={() => setForm(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
						ביטול
					</button>
					<button
						type="button"
						onClick={onSubmit}
						disabled={pending}
						className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
					>
						{form.id == null ? "צור" : "שמור"}
					</button>
				</div>
			</div>
		</div>
	);
}
