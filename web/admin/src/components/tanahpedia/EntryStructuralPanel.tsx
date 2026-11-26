import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUndoAction } from "~/components/UndoToast";
import type { EntityType } from "~/lib/tanahpedia/labels";
import { ENTITY_TYPE_LABELS } from "~/lib/tanahpedia/labels";
import { ADMIN_CREATABLE_ENTITY_TYPES } from "~/lib/tanahpedia/schema-registry";
import { removeEntity } from "~/server/tanahpedia/entries";
import { updateFamilyPersonNode } from "~/server/tanahpedia/family";
import { getPlaces, type TanahpediaPlace } from "~/server/tanahpedia/places";
import {
	createEntityAndLinkToEntry,
	getEntryStructuralContext,
	type LinkedEntityStructural,
	type PersonSex,
	type PlaceIdentificationRow,
	replacePlaceIdentifications,
	updateEntityDisplayName,
	updatePersonMainName,
	updatePersonSex,
	updateSayingDate,
} from "~/server/tanahpedia/structural";
import type { PersonPlaceFactRow } from "~/server/tanahpedia/structural-loader.server";
import { EntityExternalReferences } from "./EntityExternalReferences";
import { ExistingEntityPicker } from "./ExistingEntityPicker";

const structuralQueryKey = (entryId: string) =>
	["tanahpedia-entry-structural", entryId] as const;

interface EntryStructuralPanelProps {
	entryId: string;
}

type LinkedPersonRow = LinkedEntityStructural & {
	person: NonNullable<LinkedEntityStructural["person"]>;
};

type LinkedPlaceRow = LinkedEntityStructural & {
	place: NonNullable<LinkedEntityStructural["place"]>;
};

const PLACE_TEXT_OPTION = "__free_text__";

/** Each fact is either a linked place entity or a free-text alternative. */
interface PlaceFactDraft {
	mode: "place" | "text";
	placeId: string;
	placeText: string;
}

interface ActivityFactDraft extends PlaceFactDraft {
	key: string;
	/** Existing row id; new drafts have none and insert a fresh row. */
	id?: string;
}

function factToDraft(fact: PersonPlaceFactRow): PlaceFactDraft;
function factToDraft(
	fact: PersonPlaceFactRow | null | undefined,
): PlaceFactDraft | null;
function factToDraft(
	fact: PersonPlaceFactRow | null | undefined,
): PlaceFactDraft | null {
	if (!fact) return null;
	if (fact.placeId)
		return { mode: "place", placeId: fact.placeId, placeText: "" };
	return { mode: "text", placeId: "", placeText: fact.placeText ?? "" };
}

function activityToDraft(
	fact: PersonPlaceFactRow,
	index: number,
): ActivityFactDraft {
	return {
		key: fact.id || `new-${index}`,
		id: fact.id || undefined,
		...factToDraft(fact),
	};
}

/**
 * One place-fact picker: a select of place entities plus a free-text
 * alternative, mirroring the place_id/place_text exclusive pair.
 * `draft === null` means "no fact" (allowed only when `allowNone`).
 */
function PlaceFactRow({
	id,
	places,
	allowNone,
	draft,
	onChange,
	fallbackName,
}: {
	id: string;
	places: TanahpediaPlace[];
	allowNone: boolean;
	draft: PlaceFactDraft | null;
	onChange: (draft: PlaceFactDraft | null) => void;
	fallbackName?: string | null;
}) {
	const selectValue = !draft
		? ""
		: draft.mode === "text"
			? PLACE_TEXT_OPTION
			: draft.placeId;
	return (
		<div className="flex flex-1 gap-2">
			<select
				id={id}
				value={selectValue}
				onChange={(e) => {
					const value = e.target.value;
					if (value === "") onChange(null);
					else if (value === PLACE_TEXT_OPTION)
						onChange({
							mode: "text",
							placeId: "",
							placeText: draft?.placeText ?? "",
						});
					else onChange({ mode: "place", placeId: value, placeText: "" });
				}}
				className="border border-gray-300 rounded-md px-2 py-2 text-sm"
			>
				{allowNone && <option value="">-</option>}
				{draft?.mode === "place" &&
					draft.placeId &&
					!places.some((p) => p.id === draft.placeId) && (
						<option value={draft.placeId}>
							{fallbackName ?? draft.placeId}
						</option>
					)}
				{places.map((p) => (
					<option key={p.id} value={p.id}>
						{p.name}
					</option>
				))}
				<option value={PLACE_TEXT_OPTION}>טקסט חופשי…</option>
			</select>
			{draft?.mode === "text" && (
				<input
					value={draft.placeText}
					onChange={(e) => onChange({ ...draft, placeText: e.target.value })}
					placeholder="שם המקום"
					className="flex-1 border border-gray-300 rounded-md px-2 py-2 text-sm"
				/>
			)}
		</div>
	);
}

function assertPlaceDraft(draft: PlaceFactDraft | null): void {
	/* v8 ignore next 2 -- a "place" draft only ever comes from a non-empty
	   select option or a stored placeId, so the id is always set */
	if (draft?.mode === "place" && !draft.placeId)
		throw new Error("בחר מקום מקושר או עבור לטקסט חופשי");
	if (draft?.mode === "text" && !draft.placeText.trim())
		throw new Error("הזן טקסט חופשי או בחר מקום מקושר");
}

function PersonCard({
	row,
	onSaved,
}: {
	row: LinkedPersonRow;
	onSaved: () => void;
}) {
	const p = row.person;
	const scheduleUndo = useUndoAction();

	const [displayName, setDisplayName] = useState(row.displayName);
	const [mainName, setMainName] = useState(p.mainName ?? "");
	const [sex, setSex] = useState<PersonSex | "">(p.sex ?? "");
	const [birthPlace, setBirthPlace] = useState<PlaceFactDraft | null>(() =>
		factToDraft(p.birthPlace),
	);
	const [deathPlace, setDeathPlace] = useState<PlaceFactDraft | null>(() =>
		factToDraft(p.deathPlace),
	);
	const [activityPlaces, setActivityPlaces] = useState<ActivityFactDraft[]>(
		() => p.activityPlaces.map(activityToDraft),
	);

	useEffect(() => {
		setDisplayName(row.displayName);
		setMainName(p.mainName ?? "");
		setSex(p.sex ?? "");
	}, [row.displayName, p.mainName, p.sex]);
	useEffect(() => {
		setBirthPlace(factToDraft(p.birthPlace));
	}, [p.birthPlace]);
	useEffect(() => {
		setDeathPlace(factToDraft(p.deathPlace));
	}, [p.deathPlace]);
	useEffect(() => {
		setActivityPlaces(p.activityPlaces.map(activityToDraft));
	}, [p.activityPlaces]);

	const { data: places = [] } = useQuery({
		queryKey: ["tanahpedia-places"],
		queryFn: () => getPlaces(),
	});

	const mutEntity = useMutation({
		mutationFn: () =>
			updateEntityDisplayName({
				data: { entityId: row.entityId, name: displayName },
			}),
		onSuccess: onSaved,
	});
	const mutMain = useMutation({
		mutationFn: () =>
			updatePersonMainName({
				data: {
					personId: p.personId,
					name: mainName,
					mainNameRowId: p.mainNameRowId,
				},
			}),
		onSuccess: onSaved,
	});
	const mutSex = useMutation({
		mutationFn: () => {
			if (!sex) throw new Error("בחר מין");
			return updatePersonSex({
				data: {
					personId: p.personId,
					sex,
					sexRowId: p.sexRowId,
				},
			});
		},
		onSuccess: onSaved,
	});

	const mutPlaces = useMutation({
		mutationFn: () => {
			assertPlaceDraft(birthPlace);
			assertPlaceDraft(deathPlace);
			for (const draft of activityPlaces) assertPlaceDraft(draft);
			// CAS tokens: the facts the editor loaded, so a concurrent
			// contribution merge is detected rather than overwritten.
			const keptIds = new Set(
				activityPlaces.map((draft) => draft.id).filter(Boolean),
			);
			return updateFamilyPersonNode({
				data: {
					entityId: row.entityId,
					birthPlaceId:
						birthPlace?.mode === "place" ? birthPlace.placeId : null,
					birthPlaceText:
						birthPlace?.mode === "text" ? birthPlace.placeText.trim() : null,
					birthPlaceOriginal: p.birthPlace
						? {
								id: p.birthPlace.id,
								placeId: p.birthPlace.placeId,
								placeText: p.birthPlace.placeText,
							}
						: null,
					deathPlaceId:
						deathPlace?.mode === "place" ? deathPlace.placeId : null,
					deathPlaceText:
						deathPlace?.mode === "text" ? deathPlace.placeText.trim() : null,
					deathPlaceOriginal: p.deathPlace
						? {
								id: p.deathPlace.id,
								placeId: p.deathPlace.placeId,
								placeText: p.deathPlace.placeText,
							}
						: null,
					activityPlaces: activityPlaces.map((draft) => {
						const loaded = draft.id
							? p.activityPlaces.find((fact) => fact.id === draft.id)
							: undefined;
						return {
							id: draft.id ?? null,
							placeId: draft.mode === "place" ? draft.placeId : null,
							placeText: draft.mode === "text" ? draft.placeText.trim() : null,
							...(loaded
								? {
										originalPlaceId: loaded.placeId,
										originalPlaceText: loaded.placeText,
									}
								: {}),
						};
					}),
					removedActivityPlaces: p.activityPlaces
						.filter((fact) => fact.id !== "" && !keptIds.has(fact.id))
						.map((fact) => ({
							id: fact.id,
							originalPlaceId: fact.placeId,
							originalPlaceText: fact.placeText,
						})),
				},
			});
		},
		onSuccess: onSaved,
	});

	const mutRemove = useMutation({
		mutationFn: () => removeEntity({ data: row.linkId }),
		onSuccess: onSaved,
	});

	const busy =
		mutEntity.isPending ||
		mutMain.isPending ||
		mutSex.isPending ||
		mutPlaces.isPending ||
		mutRemove.isPending;

	return (
		<div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
			<div className="flex justify-between items-center gap-2">
				<span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
					{ENTITY_TYPE_LABELS.PERSON}
				</span>
				<button
					type="button"
					disabled={busy}
					onClick={() =>
						scheduleUndo({
							key: `entity-link-${row.linkId}`,
							message: "קישור הישות יוסר מהערך",
							commit: () => mutRemove.mutate(),
						})
					}
					className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
				>
					הסר קישור
				</button>
			</div>
			<p className="text-xs text-gray-400 font-mono break-all">
				{row.entityId}
			</p>
			<div>
				<label
					htmlFor={`dn-${row.entityId}`}
					className="block text-sm font-medium text-gray-700 mb-1"
				>
					שם יישות (tanahpedia_entity.name)
				</label>
				<input
					id={`dn-${row.entityId}`}
					value={displayName}
					onChange={(e) => setDisplayName(e.target.value)}
					className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
				/>
				<button
					type="button"
					disabled={busy}
					onClick={() => mutEntity.mutate()}
					className="mt-2 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
				>
					שמור שם יישות
				</button>
			</div>
			<div>
				<label
					htmlFor={`mn-${row.entityId}`}
					className="block text-sm font-medium text-gray-700 mb-1"
				>
					שם ראשי (person_name / MAIN)
				</label>
				<input
					id={`mn-${row.entityId}`}
					value={mainName}
					onChange={(e) => setMainName(e.target.value)}
					className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
				/>
				<button
					type="button"
					disabled={busy}
					onClick={() => mutMain.mutate()}
					className="mt-2 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
				>
					שמור שם איש
				</button>
			</div>
			<div>
				<label
					htmlFor={`sx-${row.entityId}`}
					className="block text-sm font-medium text-gray-700 mb-1"
				>
					מין (person_sex)
				</label>
				<select
					id={`sx-${row.entityId}`}
					value={sex}
					onChange={(e) => setSex(e.target.value as PersonSex | "")}
					className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
				>
					<option value="">-</option>
					<option value="MALE">MALE</option>
					<option value="FEMALE">FEMALE</option>
					<option value="UNKNOWN">UNKNOWN</option>
				</select>
				<button
					type="button"
					disabled={busy || !sex}
					onClick={() => mutSex.mutate()}
					className="mt-2 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
				>
					שמור מין
				</button>
			</div>
			<div className="space-y-2">
				<span className="block text-sm font-medium text-gray-700">
					מקומות (מקום מקושר או טקסט חופשי)
				</span>
				<div>
					<label
						htmlFor={`bp-${row.entityId}`}
						className="block text-xs text-gray-600 mb-1"
					>
						מקום לידה
					</label>
					<PlaceFactRow
						id={`bp-${row.entityId}`}
						places={places}
						allowNone
						draft={birthPlace}
						onChange={setBirthPlace}
						fallbackName={p.birthPlace?.placeName}
					/>
				</div>
				<div>
					<label
						htmlFor={`dp-${row.entityId}`}
						className="block text-xs text-gray-600 mb-1"
					>
						מקום פטירה
					</label>
					<PlaceFactRow
						id={`dp-${row.entityId}`}
						places={places}
						allowNone
						draft={deathPlace}
						onChange={setDeathPlace}
						fallbackName={p.deathPlace?.placeName}
					/>
				</div>
				<div>
					<div className="flex justify-between items-center">
						<span className="text-xs text-gray-600">מקומות פעילות</span>
						<button
							type="button"
							onClick={() =>
								setActivityPlaces((prev) => [
									...prev,
									{
										key: `new-${Date.now()}`,
										mode: "text",
										placeId: "",
										placeText: "",
									},
								])
							}
							className="text-sm text-blue-600 hover:text-blue-800"
						>
							+ מקום
						</button>
					</div>
					{activityPlaces.map((draft, index) => (
						<div key={draft.key} className="flex gap-2 items-center mt-2">
							<PlaceFactRow
								id={`ap-${row.entityId}-${index}`}
								places={places}
								allowNone={false}
								draft={draft}
								onChange={(next) =>
									setActivityPlaces((prev) => {
										/* v8 ignore if -- allowNone is false here, so PlaceFactRow
										   never emits null; the מחק button is the remove path */
										if (next === null)
											return prev.filter((_, i) => i !== index);
										return prev.map((d, i) =>
											i === index ? { ...d, ...next } : d,
										);
									})
								}
							/>
							<button
								type="button"
								onClick={() =>
									setActivityPlaces((prev) =>
										prev.filter((_, i) => i !== index),
									)
								}
								className="text-sm text-red-600"
							>
								מחק
							</button>
						</div>
					))}
				</div>
				<button
					type="button"
					disabled={busy}
					onClick={() => mutPlaces.mutate()}
					className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
				>
					שמור מקומות
				</button>
				{mutPlaces.error && (
					<p role="alert" className="text-sm text-red-600">
						{mutPlaces.error.message}
					</p>
				)}
			</div>
			<EntityExternalReferences
				entityId={row.entityId}
				references={row.externalReferences}
				onSaved={onSaved}
			/>
		</div>
	);
}

function identKey(r: PlaceIdentificationRow, i: number): string {
	return r.id || `new-${i}`;
}

function PlaceCard({
	row,
	onSaved,
}: {
	row: LinkedPlaceRow;
	onSaved: () => void;
}) {
	const pl = row.place;
	const scheduleUndo = useUndoAction();

	const [displayName, setDisplayName] = useState(row.displayName);
	const [rows, setRows] = useState<PlaceIdentificationRow[]>(
		() => pl.identifications,
	);

	useEffect(() => {
		setDisplayName(row.displayName);
		setRows([...pl.identifications]);
	}, [row.displayName, pl.identifications]);

	const mutEntity = useMutation({
		mutationFn: () =>
			updateEntityDisplayName({
				data: { entityId: row.entityId, name: displayName },
			}),
		onSuccess: onSaved,
	});
	const mutIdents = useMutation({
		mutationFn: () =>
			replacePlaceIdentifications({
				data: {
					placeId: pl.placeId,
					rows: rows.map((r) => ({
						id: r.id.startsWith("new-") ? undefined : r.id,
						modern_name: r.modern_name,
						latitude: r.latitude,
						longitude: r.longitude,
					})),
				},
			}),
		onSuccess: onSaved,
	});
	const mutRemove = useMutation({
		mutationFn: () => removeEntity({ data: row.linkId }),
		onSuccess: onSaved,
	});

	const busy =
		mutEntity.isPending || mutIdents.isPending || mutRemove.isPending;

	const updateRow = useCallback(
		(index: number, patch: Partial<PlaceIdentificationRow>) => {
			setRows((prev) =>
				prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
			);
		},
		[],
	);

	const addRow = useCallback(() => {
		setRows((prev) => [
			...prev,
			{
				id: `new-${Date.now()}`,
				modern_name: "",
				latitude: null,
				longitude: null,
			},
		]);
	}, []);

	const removeRow = useCallback((index: number) => {
		setRows((prev) => prev.filter((_, i) => i !== index));
	}, []);

	return (
		<div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
			<div className="flex justify-between items-center gap-2">
				<span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
					{ENTITY_TYPE_LABELS.PLACE}
				</span>
				<button
					type="button"
					disabled={busy}
					onClick={() =>
						scheduleUndo({
							key: `entity-link-${row.linkId}`,
							message: "קישור הישות יוסר מהערך",
							commit: () => mutRemove.mutate(),
						})
					}
					className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
				>
					הסר קישור
				</button>
			</div>
			<p className="text-xs text-gray-400 font-mono break-all">
				{row.entityId}
			</p>
			<div>
				<label
					htmlFor={`pdn-${row.entityId}`}
					className="block text-sm font-medium text-gray-700 mb-1"
				>
					שם יישות (tanahpedia_entity.name)
				</label>
				<input
					id={`pdn-${row.entityId}`}
					value={displayName}
					onChange={(e) => setDisplayName(e.target.value)}
					className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
				/>
				<button
					type="button"
					disabled={busy}
					onClick={() => mutEntity.mutate()}
					className="mt-2 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
				>
					שמור שם יישות
				</button>
			</div>
			<div className="space-y-2">
				<div className="flex justify-between items-center">
					<span className="text-sm font-medium text-gray-700">
						זיהויים (place_identification)
					</span>
					<button
						type="button"
						onClick={addRow}
						className="text-sm text-blue-600 hover:text-blue-800"
					>
						+ שורה
					</button>
				</div>
				{rows.map((r, i) => (
					<div
						key={identKey(r, i)}
						className="grid grid-cols-1 md:grid-cols-4 gap-2 p-2 bg-gray-50 rounded-md"
					>
						<input
							placeholder="שם מודרני"
							value={r.modern_name ?? ""}
							onChange={(e) =>
								updateRow(i, { modern_name: e.target.value || null })
							}
							className="border border-gray-300 rounded px-2 py-1 text-sm"
						/>
						<input
							placeholder="latitude"
							type="number"
							step="any"
							value={r.latitude ?? ""}
							onChange={(e) =>
								updateRow(i, {
									latitude:
										e.target.value === "" ? null : Number(e.target.value),
								})
							}
							className="border border-gray-300 rounded px-2 py-1 text-sm"
						/>
						<input
							placeholder="longitude"
							type="number"
							step="any"
							value={r.longitude ?? ""}
							onChange={(e) =>
								updateRow(i, {
									longitude:
										e.target.value === "" ? null : Number(e.target.value),
								})
							}
							className="border border-gray-300 rounded px-2 py-1 text-sm"
						/>
						<button
							type="button"
							onClick={() => removeRow(i)}
							className="text-sm text-red-600"
						>
							מחק
						</button>
					</div>
				))}
				<button
					type="button"
					disabled={busy}
					onClick={() => mutIdents.mutate()}
					className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
				>
					שמור זיהויים
				</button>
			</div>
			<EntityExternalReferences
				entityId={row.entityId}
				references={row.externalReferences}
				onSaved={onSaved}
			/>
		</div>
	);
}

function GenericEntityCard({
	row,
	onSaved,
}: {
	row: LinkedEntityStructural;
	onSaved: () => void;
}) {
	const scheduleUndo = useUndoAction();
	const [displayName, setDisplayName] = useState(row.displayName);
	const [sayingDate, setSayingDate] = useState(
		row.saying?.sayingDate?.toString() ?? "",
	);
	useEffect(() => {
		setDisplayName(row.displayName);
	}, [row.displayName]);
	useEffect(() => {
		setSayingDate(row.saying?.sayingDate?.toString() ?? "");
	}, [row.saying?.sayingDate]);

	const mutEntity = useMutation({
		mutationFn: () =>
			updateEntityDisplayName({
				data: { entityId: row.entityId, name: displayName },
			}),
		onSuccess: onSaved,
	});
	const mutRemove = useMutation({
		mutationFn: () => removeEntity({ data: row.linkId }),
		onSuccess: onSaved,
	});
	const mutSayingDate = useMutation({
		mutationFn: () => {
			if (!row.saying) throw new Error("אמרה חסרה");
			return updateSayingDate({
				data: {
					sayingId: row.saying.sayingId,
					sayingDate: sayingDate.trim() === "" ? null : Number(sayingDate),
				},
			});
		},
		onSuccess: onSaved,
	});
	const busy =
		mutEntity.isPending || mutRemove.isPending || mutSayingDate.isPending;
	const label = ENTITY_TYPE_LABELS[row.entityType] ?? row.entityType;

	return (
		<div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
			<div className="flex justify-between items-center">
				<span className="text-xs font-semibold text-gray-500">{label}</span>
				<button
					type="button"
					disabled={busy}
					onClick={() =>
						scheduleUndo({
							key: `entity-link-${row.linkId}`,
							message: "קישור הישות יוסר מהערך",
							commit: () => mutRemove.mutate(),
						})
					}
					className="text-xs text-red-600"
				>
					הסר קישור
				</button>
			</div>
			<p className="text-xs text-gray-400 font-mono break-all">
				{row.entityId}
			</p>
			<input
				value={displayName}
				onChange={(e) => setDisplayName(e.target.value)}
				className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
			/>
			<button
				type="button"
				disabled={busy}
				onClick={() => mutEntity.mutate()}
				className="text-sm text-blue-600"
			>
				שמור שם יישות
			</button>
			{row.saying ? (
				<div>
					<label htmlFor={`sd-${row.entityId}`} className="block text-sm">
						תאריך האמרה
					</label>
					<p className="text-xs text-gray-500">
						שנה, חודש ויום עבריים בשמונה ספרות, למשל 24480906. כתבו 00 לרכיב
						שאינו ידוע, או השאירו ריק לתאריך לא ידוע.
					</p>
					<input
						id={`sd-${row.entityId}`}
						inputMode="numeric"
						value={sayingDate}
						onChange={(e) => setSayingDate(e.target.value)}
						className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
					/>
					<button
						type="button"
						disabled={busy}
						onClick={() => mutSayingDate.mutate()}
						className="mt-2 text-sm text-blue-600"
					>
						שמור תאריך אמרה
					</button>
					{mutSayingDate.error && (
						<p role="alert" className="text-sm text-red-600">
							{mutSayingDate.error.message}
						</p>
					)}
				</div>
			) : (
				<p className="text-xs text-amber-800 bg-amber-50 rounded p-2">
					עריכת שדות מורחבת לסוג זה תתווסף בהמשך - כרגע רק שם בישות הבסיס.
				</p>
			)}
			<EntityExternalReferences
				entityId={row.entityId}
				references={row.externalReferences}
				onSaved={onSaved}
			/>
		</div>
	);
}

export function EntryStructuralPanel({ entryId }: EntryStructuralPanelProps) {
	const queryClient = useQueryClient();
	const invalidate = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: structuralQueryKey(entryId),
		});
		// Entity membership feeds the image panel's entity groups too.
		void queryClient.invalidateQueries({
			queryKey: ["tanahpedia-entry-images", entryId],
		});
	}, [queryClient, entryId]);

	const { data, isLoading, error } = useQuery({
		queryKey: structuralQueryKey(entryId),
		queryFn: () => getEntryStructuralContext({ data: entryId }),
	});

	const [newType, setNewType] = useState<EntityType>("PERSON");
	const [newName, setNewName] = useState("");
	const mutCreate = useMutation({
		mutationFn: () =>
			createEntityAndLinkToEntry({
				data: {
					entryId,
					entityType: newType,
					displayName: newName.trim(),
				},
			}),
		onSuccess: () => {
			setNewName("");
			invalidate();
		},
	});

	const createOptions = useMemo(() => ADMIN_CREATABLE_ENTITY_TYPES, []);

	if (isLoading) {
		return (
			<div className="flex justify-center py-8">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			</div>
		);
	}
	if (error) {
		return (
			<div className="text-red-600 text-sm">
				שגיאה בטעינת מבנה יישויות: {String(error)}
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="rounded-xl border border-gray-200 bg-gray-50/80 p-5">
				<h2 className="text-lg font-bold text-gray-900 mb-1">
					יישויות מקושרות ומבנה DB
				</h2>
				<p className="text-sm text-gray-600 mb-4">
					שדות ממופים לטבלאות MySQL (entity, person_*, place_*). שינויים נשמרים
					בלחיצה על כפתורי השמירה בכל כרטיס.
				</p>
				<div className="flex flex-wrap gap-2 items-end">
					<div>
						<label
							htmlFor="new-entity-type"
							className="block text-xs font-medium text-gray-600 mb-1"
						>
							סוג
						</label>
						<select
							id="new-entity-type"
							value={newType}
							onChange={(e) => setNewType(e.target.value as EntityType)}
							className="border border-gray-300 rounded-md px-2 py-2 text-sm"
						>
							{createOptions.map((t) => (
								<option key={t} value={t}>
									{ENTITY_TYPE_LABELS[t]}
								</option>
							))}
						</select>
					</div>
					<div className="flex-1 min-w-[12rem]">
						<label
							htmlFor="new-entity-name"
							className="block text-xs font-medium text-gray-600 mb-1"
						>
							שם ראשוני
						</label>
						<input
							id="new-entity-name"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
							placeholder="שם ליישות חדשה"
						/>
					</div>
					<button
						type="button"
						disabled={mutCreate.isPending || !newName.trim()}
						onClick={() => mutCreate.mutate()}
						className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
					>
						צור וקשר לערך
					</button>
				</div>
				{mutCreate.isError && (
					<p className="text-red-600 text-sm mt-2">
						{mutCreate.error instanceof Error
							? mutCreate.error.message
							: String(mutCreate.error)}
					</p>
				)}

				<ExistingEntityPicker
					entryId={entryId}
					entityType={newType}
					onLinked={invalidate}
				/>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				{data?.linkedEntities.map((row) => {
					if (row.entityType === "PERSON" && row.person) {
						return (
							<PersonCard
								key={row.linkId}
								row={row as LinkedPersonRow}
								onSaved={invalidate}
							/>
						);
					}
					if (row.entityType === "PLACE" && row.place) {
						return (
							<PlaceCard
								key={row.linkId}
								row={row as LinkedPlaceRow}
								onSaved={invalidate}
							/>
						);
					}
					return (
						<GenericEntityCard
							key={row.linkId}
							row={row}
							onSaved={invalidate}
						/>
					);
				})}
			</div>
			{data?.linkedEntities.length === 0 && (
				<p className="text-sm text-gray-500 text-center py-4">
					אין יישויות מקושרות לערך זה.
				</p>
			)}
		</div>
	);
}
