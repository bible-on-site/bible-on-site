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
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<div>
					<Link
						to="/rabbis"
						className="text-blue-600 hover:text-blue-700 text-sm"
					>
						← חזרה לרשימת הרבנים
					</Link>
					<h1 className="text-2xl font-bold text-gray-900 mt-1">
						{isNew ? "רב חדש" : "עריכת רב"}
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
							className="text-red-600 hover:text-red-700 text-sm"
						>
							מחק רב
						</button>
					)}
				</div>
			</div>

			<form className="space-y-6 bg-white p-6 rounded-lg shadow border border-gray-200">
				<div className="grid md:grid-cols-2 gap-6">
					<div className="space-y-6">
						<div>
							<label
								htmlFor="name"
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								שם הרב *
							</label>
							<input
								id="name"
								type="text"
								value={formData.name}
								onChange={(e) => handleFieldChange("name", e.target.value)}
								className="w-full border border-gray-300 rounded-lg px-4 py-2"
								placeholder="הכנס שם הרב"
							/>
						</div>

						<div>
							<label
								htmlFor="details"
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								פרטים
							</label>
							<textarea
								id="details"
								value={formData.details}
								onChange={(e) => handleFieldChange("details", e.target.value)}
								rows={6}
								className="w-full border border-gray-300 rounded-lg px-4 py-2"
								placeholder="תיאור הרב, תפקידים, השכלה וכו'"
							/>
						</div>
					</div>

					<div>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: ImageUpload is a custom component */}
						<label className="block text-sm font-medium text-gray-700 mb-3">
							תמונת הרב (S3)
						</label>
						{isNew ? (
							<div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500">
								שמור את הרב לפני העלאת תמונה
							</div>
						) : (
							<ImageUpload
								currentImageUrl={author?.imageUrl ?? undefined}
								onUpload={handleImageUpload}
							/>
						)}
					</div>
				</div>

				<div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
					<Link
						to="/rabbis"
						className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
					>
						ביטול
					</Link>
					<button
						type="button"
						onClick={() => saveMutation.mutate(formData)}
						disabled={saveMutation.isPending || !formData.name.trim()}
						className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
					>
						{saveMutation.isPending ? "שומר..." : "שמור עכשיו"}
					</button>
				</div>
			</form>
		</div>
	);
}
