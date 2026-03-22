import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EntityType } from "~/lib/tanahpedia/labels";
import { ENTITY_TYPE_LABELS } from "~/lib/tanahpedia/labels";
import { ADMIN_CREATABLE_ENTITY_TYPES } from "~/lib/tanahpedia/schema-registry";
import { removeEntity } from "~/server/tanahpedia/entries";
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
} from "~/server/tanahpedia/structural";

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

function PersonCard({
	row,
	onSaved,
}: {
	row: LinkedPersonRow;
	onSaved: () => void;
}) {
	const p = row.person;

	const [displayName, setDisplayName] = useState(row.displayName);
	const [mainName, setMainName] = useState(p.mainName ?? "");
	const [sex, setSex] = useState<PersonSex | "">(p.sex ?? "");

	useEffect(() => {
		setDisplayName(row.displayName);
		setMainName(p.mainName ?? "");
		setSex(p.sex ?? "");
	}, [row.displayName, p.mainName, p.sex]);

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

	const mutRemove = useMutation({
		mutationFn: () => removeEntity({ data: row.linkId }),
		onSuccess: onSaved,
	});

	const busy =
		mutEntity.isPending ||
		mutMain.isPending ||
		mutSex.isPending ||
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
					onClick={() => {
						if (window.confirm("להסיר קישור יישות מהערך?")) mutRemove.mutate();
					}}
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
					<option value="">—</option>
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
					onClick={() => {
						if (window.confirm("להסיר קישור יישות מהערך?")) mutRemove.mutate();
					}}
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
	const [displayName, setDisplayName] = useState(row.displayName);
	useEffect(() => {
		setDisplayName(row.displayName);
	}, [row.displayName]);

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
	const busy = mutEntity.isPending || mutRemove.isPending;
	const label = ENTITY_TYPE_LABELS[row.entityType] ?? row.entityType;

	return (
		<div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
			<div className="flex justify-between items-center">
				<span className="text-xs font-semibold text-gray-500">{label}</span>
				<button
					type="button"
					disabled={busy}
					onClick={() => {
						if (window.confirm("להסיר קישור יישות מהערך?")) mutRemove.mutate();
					}}
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
			<p className="text-xs text-amber-800 bg-amber-50 rounded p-2">
				עריכת שדות מורחבת לסוג זה תתווסף בהמשך — כרגע רק שם בישות הבסיס.
			</p>
		</div>
	);
}

export function EntryStructuralPanel({ entryId }: EntryStructuralPanelProps) {
	const queryClient = useQueryClient();
	const invalidate = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: structuralQueryKey(entryId),
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

	const createOptions = useMemo(
		() =>
			ADMIN_CREATABLE_ENTITY_TYPES.filter(
				(t) => t === "PERSON" || t === "PLACE",
			),
		[],
	);

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
