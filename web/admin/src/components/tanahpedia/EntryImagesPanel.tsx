import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { useUndoAction } from "~/components/UndoToast";
import { classifySaveError } from "~/lib/server-fn-errors";
import { createPediaImageUpload, uploadPediaImageChunk } from "~/server/s3";
import {
	clearPrimaryImage,
	type EntityImageGroup,
	type ImageOwnerKind,
	type PediaImageAssetInput,
	type PediaImageLinkView,
	putImageAsset,
	putImageLink,
	removeImageLink,
	getEntryImageBundle,
} from "~/server/tanahpedia/images";

interface EntryImagesPanelProps {
	entryId: string;
}

interface AssetDraft {
	imageId: string | null;
	url: string;
	width: string;
	height: string;
	altText: string;
	caption: string;
	creator: string;
	creditLine: string;
	sourceName: string;
	sourceUrl: string;
	licenseName: string;
	licenseUrl: string;
	isPublicDomain: boolean;
	modifications: string;
	permissionEvidence: string;
	isPublic: boolean;
	revision: number | null;
}

const EMPTY_DRAFT: AssetDraft = {
	imageId: null,
	url: "",
	width: "",
	height: "",
	altText: "",
	caption: "",
	creator: "",
	creditLine: "",
	sourceName: "",
	sourceUrl: "",
	licenseName: "",
	licenseUrl: "",
	isPublicDomain: false,
	modifications: "",
	permissionEvidence: "",
	isPublic: false,
	revision: null,
};

interface EditorState {
	draft: AssetDraft;
	/** Owner to attach the saved asset to; null when editing an existing image. */
	attachTo: { ownerKind: ImageOwnerKind; ownerId: string } | null;
}

function draftFromLink(link: PediaImageLinkView): AssetDraft {
	const image = link.image;
	return {
		imageId: image.imageId,
		url: image.url,
		width: image.width?.toString() ?? "",
		height: image.height?.toString() ?? "",
		altText: image.altText,
		caption: image.caption ?? "",
		creator: image.creator ?? "",
		creditLine: image.creditLine ?? "",
		sourceName: image.sourceName ?? "",
		sourceUrl: image.sourceUrl ?? "",
		licenseName: image.licenseName ?? "",
		licenseUrl: image.licenseUrl ?? "",
		isPublicDomain: image.isPublicDomain,
		modifications: image.modifications ?? "",
		permissionEvidence: image.permissionEvidence ?? "",
		isPublic: image.isPublic,
		revision: image.revision,
	};
}

function draftToInput(draft: AssetDraft): PediaImageAssetInput {
	const toInt = (value: string) => {
		const n = Number.parseInt(value.trim(), 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	};
	return {
		id: draft.imageId,
		url: draft.url,
		width: toInt(draft.width),
		height: toInt(draft.height),
		altText: draft.altText,
		caption: draft.caption,
		creator: draft.creator,
		creditLine: draft.creditLine,
		sourceName: draft.sourceName,
		sourceUrl: draft.sourceUrl,
		licenseName: draft.licenseName,
		licenseUrl: draft.licenseUrl,
		isPublicDomain: draft.isPublicDomain,
		modifications: draft.modifications,
		permissionEvidence: draft.permissionEvidence,
		isPublic: draft.isPublic,
		revision: draft.revision,
	};
}

const INPUT_CLASS =
	"w-full border border-gray-300 rounded-md px-3 py-2 text-sm";
const LABEL_CLASS = "block text-sm font-medium text-gray-700 mb-1";

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div>
			{/* biome-ignore lint/a11y/noLabelWithoutControl: children carry the labelled input */}
			<label className={LABEL_CLASS}>{label}</label>
			{children}
		</div>
	);
}

/**
 * תמונות — the entry's image gallery editor (#3769).
 *
 * Owns both scopes rendered on the public entry page: links attached
 * directly to the entry plus the links of each entity attached to it (the
 * website merges both). Attach accepts an uploaded file (S3 via
 * chunked S3 upload) or an external URL; every save publishes
 * immediately and revalidates the site — same explicit-save boundary as the
 * alias manager.
 */
export function EntryImagesPanel({ entryId }: EntryImagesPanelProps) {
	const queryClient = useQueryClient();
	const imagesKey = ["tanahpedia-entry-images", entryId] as const;
	const { data: bundle, isLoading } = useQuery({
		queryKey: imagesKey,
		queryFn: () => getEntryImageBundle({ data: entryId }),
	});

	const [editor, setEditor] = useState<EditorState | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement | null>(null);
	const scheduleUndo = useUndoAction();

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: ["tanahpedia-entry-images"] });

	const reportError = (err: unknown) =>
		setActionError(classifySaveError(err).message);

	const saveAssetMutation = useMutation({
		mutationFn: async (state: EditorState) => {
			const asset = await putImageAsset({ data: draftToInput(state.draft) });
			if (state.attachTo) {
				await putImageLink({
					data: { ...state.attachTo, imageId: asset.imageId },
				});
			}
			return asset;
		},
		onSuccess: () => {
			setEditor(null);
			setActionError(null);
			void invalidate();
		},
		onError: reportError,
	});

	const linkMutation = useMutation({
		mutationFn: putImageLink,
		onSuccess: () => {
			setActionError(null);
			void invalidate();
		},
		onError: reportError,
	});

	const removeMutation = useMutation({
		mutationFn: removeImageLink,
		onSuccess: () => {
			setActionError(null);
			void invalidate();
		},
		onError: reportError,
	});

	const clearPrimaryMutation = useMutation({
		mutationFn: clearPrimaryImage,
		onSuccess: () => {
			setActionError(null);
			void invalidate();
		},
		onError: reportError,
	});

	const busy =
		saveAssetMutation.isPending ||
		linkMutation.isPending ||
		removeMutation.isPending ||
		clearPrimaryMutation.isPending;

	/** Swap a link's sort_order with its neighbour's. */
	const move = (
		ownerKind: ImageOwnerKind,
		ownerId: string,
		links: PediaImageLinkView[],
		index: number,
		direction: -1 | 1,
	) => {
		const a = links[index];
		const b = links[index + direction];
		if (!a || !b) return;
		for (const [link, order] of [
			[a, b.sortOrder],
			[b, a.sortOrder],
		] as const) {
			linkMutation.mutate({
				data: { id: link.id, ownerKind, ownerId, sortOrder: order },
			});
		}
	};

	const readChunk = (blob: Blob) =>
		new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () =>
				resolve((reader.result as string).split(",")[1] ?? "");
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});

	const uploadFile = async (file: File) => {
		setActionError(null);
		try {
			const session = await createPediaImageUpload({
				data: { contentType: file.type, totalSize: file.size },
			});
			let imageUrl: string | undefined;
			for (let index = 0; index < session.chunkCount; index += 1) {
				const start = index * session.chunkBytes;
				const base64Data = await readChunk(file.slice(start, start + session.chunkBytes));
				const result = await uploadPediaImageChunk({
					data: { uploadId: session.uploadId, chunkIndex: index, base64Data },
				});
				imageUrl = result.complete ? result.imageUrl : imageUrl;
			}
			if (!imageUrl) throw new Error("Image upload did not complete");
			setEditor((prev) =>
				prev ? { ...prev, draft: { ...prev.draft, url: imageUrl } } : prev,
			);
		} catch (err) {
			reportError(err);
		}
	};

	const linkRow = (
		link: PediaImageLinkView,
		index: number,
		links: PediaImageLinkView[],
		ownerLabel: string,
	) => (
		<div
			key={link.id}
			className="flex items-start gap-3 rounded-md border border-gray-200 p-3"
		>
			<img
				src={link.image.url}
				alt={link.image.altText}
				className="w-20 h-20 object-cover rounded border border-gray-100 bg-gray-50"
			/>
			<div className="flex-1 min-w-0 space-y-1">
				<div className="flex items-center gap-2 flex-wrap">
					{link.isPrimary && (
						<span className="text-xs font-semibold text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">
							ראשית
						</span>
					)}
					{!link.image.isPublic && (
						<span className="text-xs font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
							לא פורסמה
						</span>
					)}
					<span className="text-sm text-gray-800 truncate">
						{link.image.altText}
					</span>
				</div>
				<p className="text-xs text-gray-500 truncate">
					{link.image.creditLine || link.image.creator || "ללא קרדיט"}
				</p>
				<div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
					<button
						type="button"
						disabled={busy || index === 0}
						onClick={() => move(link.ownerKind, link.ownerId, links, index, -1)}
						className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40"
					>
						↑ קדם
					</button>
					<button
						type="button"
						disabled={busy || index === links.length - 1}
						onClick={() => move(link.ownerKind, link.ownerId, links, index, 1)}
						className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40"
					>
						↓ אחור
					</button>
					{!link.isPrimary && (
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								linkMutation.mutate({
									data: {
										id: link.id,
										ownerKind: link.ownerKind,
										ownerId: link.ownerId,
										isPrimary: true,
									},
								})
							}
							className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
						>
							הפוך לראשית
						</button>
					)}
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							setEditor({ draft: draftFromLink(link), attachTo: null })
						}
						className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
					>
						ערוך פרטים
					</button>
					{link.ownerKind === "ENTITY" && (
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								linkMutation.mutate({
									data: {
										ownerKind: "ENTRY",
										ownerId: entryId,
										imageId: link.image.imageId,
									},
								})
							}
							className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
						>
							קשר גם לערך
						</button>
					)}
					{link.ownerKind === "ENTRY" && ownerLabel && (
						<span className="text-xs text-gray-400">{ownerLabel}</span>
					)}
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							scheduleUndo({
								key: `image-link-${link.id}`,
								message: "קישור התמונה יוסר",
								commit: () =>
									removeMutation.mutate({
										data: { ownerKind: link.ownerKind, id: link.id },
									}),
							})
						}
						className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
					>
						הסר קישור
					</button>
				</div>
			</div>
		</div>
	);

	const scopeSection = (
		title: string,
		ownerKind: ImageOwnerKind,
		ownerId: string,
		links: PediaImageLinkView[],
		entityIdForCrossLink: string | null,
	) => (
		<div className="space-y-2">
			<div className="flex justify-between items-center">
				<h4 className="text-sm font-semibold text-gray-800">{title}</h4>
				<div className="flex gap-3">
					{links.some((l) => l.isPrimary) && (
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								clearPrimaryMutation.mutate({
									data: { ownerKind, ownerId },
								})
							}
							className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
						>
							בטל תמונה ראשית
						</button>
					)}
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							setEditor({
								draft: EMPTY_DRAFT,
								attachTo: { ownerKind, ownerId },
							})
						}
						className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
					>
						+ הוסף תמונה
					</button>
				</div>
			</div>
			{links.length === 0 ? (
				<p className="text-xs text-gray-400">אין תמונות מקושרות.</p>
			) : (
				links.map((link, index) =>
					linkRow(link, index, links, entityIdForCrossLink ?? ""),
				)
			)}
		</div>
	);

	return (
		<div className="rounded-lg border border-gray-200 bg-white p-4 space-y-5">
			<span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
				תמונות
			</span>

			{actionError && (
				<div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
					{actionError}
				</div>
			)}

			{isLoading ? (
				<div className="flex items-center justify-center h-20">
					<div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
				</div>
			) : (
				<>
					{scopeSection(
						"תמונות הערך",
						"ENTRY",
						entryId,
						bundle?.entryLinks ?? [],
						null,
					)}
					{(bundle?.entityGroups ?? []).map((group: EntityImageGroup) => (
						<div key={group.entityId}>
							{scopeSection(
								`תמונות ${group.entityName}`,
								"ENTITY",
								group.entityId,
								group.links,
								group.entityId,
							)}
						</div>
					))}
				</>
			)}

			{editor && (
				<div className="rounded-md border border-blue-200 bg-blue-50/40 p-4 space-y-4">
					<h4 className="text-sm font-semibold text-gray-800">
						{editor.draft.imageId ? "עריכת פרטי תמונה" : "תמונה חדשה"}
						{editor.attachTo
							? editor.attachTo.ownerKind === "ENTRY"
								? " — תקשר לערך"
								: " — תקשר לישות"
							: ""}
					</h4>

					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<Field label="העלאת קובץ (S3)">
							<input
								ref={fileRef}
								type="file"
								accept="image/jpeg,image/png,image/webp"
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) void uploadFile(file);
									e.target.value = "";
								}}
								className="w-full text-sm"
							/>
						</Field>
						<Field label="כתובת התמונה *">
							<input
								value={editor.draft.url}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, url: e.target.value },
									})
								}
								placeholder="https://…"
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="טקסט חלופי (alt) *">
							<input
								value={editor.draft.altText}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, altText: e.target.value },
									})
								}
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="כיתוב תצוגה (credit line)">
							<input
								value={editor.draft.creditLine}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, creditLine: e.target.value },
									})
								}
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="יוצר / צלם">
							<input
								value={editor.draft.creator}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, creator: e.target.value },
									})
								}
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="כיתוב (caption)">
							<input
								value={editor.draft.caption}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, caption: e.target.value },
									})
								}
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="מקור (אוסף/אתר)">
							<input
								value={editor.draft.sourceName}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, sourceName: e.target.value },
									})
								}
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="כתובת פריט המקור">
							<input
								value={editor.draft.sourceUrl}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, sourceUrl: e.target.value },
									})
								}
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="רישיון">
							<input
								value={editor.draft.licenseName}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, licenseName: e.target.value },
									})
								}
								placeholder="למשל CC BY-SA 4.0"
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="כתובת הרישיון">
							<input
								value={editor.draft.licenseUrl}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, licenseUrl: e.target.value },
									})
								}
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="רוחב (px)">
							<input
								value={editor.draft.width}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, width: e.target.value },
									})
								}
								inputMode="numeric"
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="גובה (px)">
							<input
								value={editor.draft.height}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: { ...editor.draft, height: e.target.value },
									})
								}
								inputMode="numeric"
								className={INPUT_CLASS}
							/>
						</Field>
						<Field label="שינויים מפריט המקור (חיתוך וכו')">
							<input
								value={editor.draft.modifications}
								onChange={(e) =>
									setEditor({
										...editor,
										draft: {
											...editor.draft,
											modifications: e.target.value,
										},
									})
								}
								className={INPUT_CLASS}
							/>
						</Field>
						<div className="flex items-end gap-4">
							<label className="flex items-center gap-2 text-sm text-gray-700">
								<input
									type="checkbox"
									checked={editor.draft.isPublicDomain}
									onChange={(e) =>
										setEditor({
											...editor,
											draft: {
												...editor.draft,
												isPublicDomain: e.target.checked,
											},
										})
									}
								/>
								נחלת הכלל
							</label>
							<label className="flex items-center gap-2 text-sm text-gray-700">
								<input
									type="checkbox"
									checked={editor.draft.isPublic}
									onChange={(e) =>
										setEditor({
											...editor,
											draft: {
												...editor.draft,
												isPublic: e.target.checked,
											},
										})
									}
								/>
								פרסם לקוראים
							</label>
						</div>
					</div>

					<Field label="ראיות רשות / נחלת הכלל (פרטי — נדרש לפרסום)">
						<textarea
							value={editor.draft.permissionEvidence}
							onChange={(e) =>
								setEditor({
									...editor,
									draft: {
										...editor.draft,
										permissionEvidence: e.target.value,
									},
								})
							}
							rows={3}
							className={INPUT_CLASS}
						/>
					</Field>

					<div className="flex gap-3">
						<button
							type="button"
							disabled={busy}
							onClick={() => saveAssetMutation.mutate(editor)}
							className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
						>
							{saveAssetMutation.isPending ? "שומר…" : "שמור תמונה"}
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => setEditor(null)}
							className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
						>
							בטל
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
