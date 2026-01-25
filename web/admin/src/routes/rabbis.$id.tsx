import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AutoSaveIndicator } from "~/components/AutoSaveIndicator";
import { ImageUpload } from "~/components/ImageUpload";
import {
	type Author,
	createAuthor,
	deleteAuthor,
	getAuthor,
	updateAuthor,
} from "~/server/authors";
import { uploadAuthorImage } from "~/server/s3";

interface AuthorFormData {
	name: string;
	details: string;
}

export const Route = createFileRoute("/rabbis/$id")({
	component: RabbiEditPage,
});

function RabbiEditPage() {
	const { id } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const isNew = id === "new";
	const authorId = isNew ? null : Number.parseInt(id, 10);

	const [formData, setFormData] = useState<AuthorFormData>({
		name: "",
		details: "",
	});

	const [hasChanges, setHasChanges] = useState(false);
	const [lastSaved, setLastSaved] = useState<Date | null>(null);

	const { data: author, isLoading: authorLoading } = useQuery({
		queryKey: ["author", authorId],
		queryFn: () => {
			if (authorId === null) throw new Error("Author ID is required");
			return getAuthor({ data: authorId });
		},
		enabled: !!authorId,
	});

	// Initialize form with author data
	useEffect(() => {
		if (author) {
			setFormData({
				name: author.name,
				details: author.details,
			});
		}
	}, [author]);

	const saveMutation = useMutation({
		mutationFn: async (data: AuthorFormData) => {
			if (isNew || authorId === null) {
				return createAuthor({ data });
			}
			return updateAuthor({ data: { id: authorId, ...data } });
		},
		onSuccess: (savedAuthor: Author) => {
			queryClient.invalidateQueries({ queryKey: ["author", savedAuthor.id] });
			queryClient.invalidateQueries({ queryKey: ["authors"] });
			setLastSaved(new Date());
			setHasChanges(false);

			if (isNew) {
				navigate({
					to: "/rabbis/$id",
					params: { id: String(savedAuthor.id) },
					replace: true,
				});
			}
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => {
			if (authorId === null) throw new Error("Author ID is required");
			return deleteAuthor({ data: authorId });
		},
		onSuccess: () => {
			navigate({ to: "/rabbis" });
		},
	});

	const handleFieldChange = useCallback(
		<K extends keyof AuthorFormData>(field: K, value: AuthorFormData[K]) => {
			setFormData((prev) => ({ ...prev, [field]: value }));
			setHasChanges(true);
		},
		[],
	);

	const handleImageUpload = useCallback(
		async (file: File) => {
			if (!authorId) {
				alert("יש לשמור את הרב לפני העלאת תמונה");
				return;
			}
			// Convert file to base64 for server function
			const reader = new FileReader();
			reader.onload = async (e) => {
				const base64 = e.target?.result as string;
				await uploadAuthorImage({
					data: {
						authorId,
						fileName: file.name,
						contentType: file.type,
						base64Data: base64.split(",")[1], // Remove data:... prefix
					},
				});
				queryClient.invalidateQueries({ queryKey: ["author", authorId] });
				queryClient.invalidateQueries({ queryKey: ["authors"] });
			};
			reader.readAsDataURL(file);
		},
		[authorId, queryClient],
	);

	// Auto-save effect
	useEffect(() => {
		if (!hasChanges || saveMutation.isPending) return;

		const timer = setTimeout(() => {
			if (formData.name.trim()) {
				saveMutation.mutate(formData);
			}
		}, 2000);

		return () => clearTimeout(timer);
	}, [formData, hasChanges, saveMutation.isPending, saveMutation]);

	const handleDelete = () => {
		if (window.confirm("האם אתה בטוח שברצונך למחוק את הרב?")) {
			deleteMutation.mutate();
		}
	};

	if (authorLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			</div>
		);
	}

	return (
		<div className="space-y-8">
			{/* Header */}
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div>
					<Link
						to="/rabbis"
						className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
					>
						<span>→</span>
						<span>חזרה לרשימת הרבנים</span>
					</Link>
					<h1 className="text-3xl font-bold text-gray-900 mt-2">
						{isNew ? "➕ רב חדש" : "✏️ עריכת רב"}
					</h1>
				</div>
				<div className="flex items-center gap-4">
					<AutoSaveIndicator
						isSaving={saveMutation.isPending}
						lastSaved={lastSaved}
						hasChanges={hasChanges}
					/>
					{!isNew && (
						<button
							type="button"
							onClick={handleDelete}
							className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 px-4 py-2 border border-red-200 rounded-lg hover:bg-red-50 transition-all font-medium text-sm"
						>
							<span>🗑️</span>
							<span>מחק רב</span>
						</button>
					)}
				</div>
			</div>

			<form className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div className="grid md:grid-cols-2 gap-8 p-8">
					{/* Form Fields */}
					<div className="space-y-6">
						<div>
							<label
								htmlFor="name"
								className="block text-sm font-semibold text-gray-700 mb-2"
							>
								שם הרב <span className="text-red-500">*</span>
							</label>
							<input
								id="name"
								type="text"
								value={formData.name}
								onChange={(e) => handleFieldChange("name", e.target.value)}
								className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
								placeholder="הכנס שם הרב"
							/>
						</div>

						<div>
							<label
								htmlFor="details"
								className="block text-sm font-semibold text-gray-700 mb-2"
							>
								פרטים
							</label>
							<textarea
								id="details"
								value={formData.details}
								onChange={(e) => handleFieldChange("details", e.target.value)}
								rows={6}
								className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none"
								placeholder="תיאור הרב, תפקידים, השכלה וכו'"
							/>
						</div>
					</div>

					{/* Image Upload */}
					<div>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: ImageUpload is a custom component */}
						<label className="block text-sm font-semibold text-gray-700 mb-3">
							📷 תמונת הרב
						</label>
						{isNew ? (
							<div className="bg-linear-to-br from-gray-50 to-gray-100 rounded-xl p-8 text-center border-2 border-dashed border-gray-300">
								<div className="text-4xl mb-3">📸</div>
								<p className="text-gray-500 font-medium">
									שמור את הרב לפני העלאת תמונה
								</p>
							</div>
						) : (
							<ImageUpload
								currentImageUrl={author?.imageUrl ?? undefined}
								onUpload={handleImageUpload}
							/>
						)}
					</div>
				</div>

				{/* Action Buttons */}
				<div className="flex justify-end gap-4 px-8 py-5 bg-gray-50 border-t border-gray-200">
					<Link
						to="/rabbis"
						className="px-6 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-100 transition-all font-medium text-gray-700"
					>
						ביטול
					</Link>
					<button
						type="button"
						onClick={() => saveMutation.mutate(formData)}
						disabled={saveMutation.isPending || !formData.name.trim()}
						className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-sm hover:shadow-md"
					>
						{saveMutation.isPending ? "⏳ שומר..." : "💾 שמור עכשיו"}
					</button>
				</div>
			</form>
		</div>
	);
}
