import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AutoSaveIndicator } from "~/components/AutoSaveIndicator";
import { WysiwygEditor } from "~/components/WysiwygEditor";
import {
	createEntry,
	deleteEntry,
	getEntry,
	updateEntry,
} from "~/server/tanahpedia/entries";

interface EntryFormData {
	unique_name: string;
	title: string;
	content: string;
}

export const Route = createFileRoute("/tanahpedia/entries/$id")({
	component: EntryEditPage,
});

function EntryEditPage() {
	const { id } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const isNew = id === "new";

	const [formData, setFormData] = useState<EntryFormData>({
		unique_name: "",
		title: "",
		content: "",
	});
	const [hasChanges, setHasChanges] = useState(false);
	const [lastSaved, setLastSaved] = useState<Date | null>(null);

	const { data: entry, isLoading } = useQuery({
		queryKey: ["tanahpedia-entry", id],
		queryFn: () => getEntry({ data: id }),
		enabled: !isNew,
	});

	useEffect(() => {
		if (entry) {
			setFormData({
				unique_name: entry.unique_name,
				title: entry.title,
				content: entry.content ?? "",
			});
		}
	}, [entry]);

	const saveMutation = useMutation({
		mutationFn: async (data: EntryFormData) => {
			if (isNew) {
				return createEntry({
					data: {
						id: crypto.randomUUID(),
						unique_name: data.unique_name,
						title: data.title,
						content: data.content,
					},
				});
			}
			return updateEntry({
				data: {
					id,
					unique_name: data.unique_name,
					title: data.title,
					content: data.content,
				},
			});
		},
		onSuccess: (savedEntry) => {
			queryClient.invalidateQueries({ queryKey: ["tanahpedia-entries"] });
			setLastSaved(new Date());
			setHasChanges(false);
			if (isNew && savedEntry?.id) {
				navigate({
					to: "/tanahpedia/entries/$id",
					params: { id: savedEntry.id },
					replace: true,
				});
			}
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => deleteEntry({ data: id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["tanahpedia-entries"] });
			navigate({ to: "/tanahpedia" });
		},
	});

	const handleFieldChange = useCallback(
		<K extends keyof EntryFormData>(field: K, value: EntryFormData[K]) => {
			setFormData((prev) => ({ ...prev, [field]: value }));
			setHasChanges(true);
		},
		[],
	);

	const handleContentChange = useCallback((content: string) => {
		setFormData((prev) => ({ ...prev, content }));
		setHasChanges(true);
	}, []);

	useEffect(() => {
		if (!hasChanges || saveMutation.isPending) return;
		const timer = setTimeout(() => {
			if (formData.title.trim()) saveMutation.mutate(formData);
		}, 2000);
		return () => clearTimeout(timer);
	}, [formData, hasChanges, saveMutation.isPending, saveMutation]);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			</div>
		);
	}

	return (
		<div className="space-y-8">
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div>
					<Link
						to="/tanahpedia"
						className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
					>
						<span>→</span>
						<span>חזרה לתנכפדיה</span>
					</Link>
					<h1 className="text-3xl font-bold text-gray-900 mt-2">
						{isNew ? "ערך חדש" : `עריכת ערך: ${entry?.title ?? ""}`}
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
							onClick={() => {
								if (window.confirm("האם אתה בטוח שברצונך למחוק ערך זה?"))
									deleteMutation.mutate();
							}}
							className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 px-4 py-2 border border-red-200 rounded-lg hover:bg-red-50 transition-all font-medium text-sm"
						>
							מחק ערך
						</button>
					)}
				</div>
			</div>

			<form className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div className="p-8 space-y-6">
					<div className="grid md:grid-cols-2 gap-6">
						<div>
							<label
								htmlFor="title"
								className="block text-sm font-semibold text-gray-700 mb-2"
							>
								כותרת <span className="text-red-500">*</span>
							</label>
							<input
								id="title"
								type="text"
								value={formData.title}
								onChange={(e) => handleFieldChange("title", e.target.value)}
								className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
								placeholder="כותרת הערך"
							/>
						</div>
						<div>
							<label
								htmlFor="unique_name"
								className="block text-sm font-semibold text-gray-700 mb-2"
							>
								שם ייחודי (URL)
							</label>
							<input
								id="unique_name"
								type="text"
								value={formData.unique_name}
								onChange={(e) =>
									handleFieldChange("unique_name", e.target.value)
								}
								className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
								placeholder="שם-ייחודי-בurl"
							/>
						</div>
					</div>

					<div>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: WysiwygEditor is a custom component */}
						<label className="block text-sm font-semibold text-gray-700 mb-2">
							תוכן הערך
						</label>
						<WysiwygEditor
							content={formData.content}
							onChange={handleContentChange}
							placeholder="הכנס את תוכן הערך..."
						/>
					</div>
				</div>

				<div className="flex justify-end gap-4 px-8 py-5 bg-gray-50 border-t border-gray-200">
					<Link
						to="/tanahpedia"
						className="px-6 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-100 transition-all font-medium text-gray-700"
					>
						ביטול
					</Link>
					<button
						type="button"
						onClick={() => saveMutation.mutate(formData)}
						disabled={saveMutation.isPending || !formData.title.trim()}
						className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-sm hover:shadow-md"
					>
						{saveMutation.isPending ? "שומר..." : "שמור עכשיו"}
					</button>
				</div>
			</form>
		</div>
	);
}
