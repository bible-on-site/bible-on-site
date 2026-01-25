import { useCallback, useState } from "react";

interface ImageUploadProps {
	currentImageUrl?: string;
	onUpload: (file: File) => Promise<void>;
	onRemove?: () => void;
}

export function ImageUpload({
	currentImageUrl,
	onUpload,
	onRemove,
}: ImageUploadProps) {
	const [isUploading, setIsUploading] = useState(false);
	const [dragActive, setDragActive] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	const handleFile = useCallback(
		async (file: File) => {
			if (!file.type.startsWith("image/")) {
				alert("יש להעלות קובץ תמונה בלבד");
				return;
			}

			// Show preview
			const reader = new FileReader();
			reader.onload = (e) => {
				setPreviewUrl(e.target?.result as string);
			};
			reader.readAsDataURL(file);

			// Upload
			setIsUploading(true);
			try {
				await onUpload(file);
			} catch (error) {
				console.error("Upload failed:", error);
				alert("העלאת התמונה נכשלה");
				setPreviewUrl(null);
			} finally {
				setIsUploading(false);
			}
		},
		[onUpload],
	);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setDragActive(false);

			const file = e.dataTransfer.files[0];
			if (file) {
				handleFile(file);
			}
		},
		[handleFile],
	);

	const handleDrag = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.type === "dragenter" || e.type === "dragover") {
			setDragActive(true);
		} else if (e.type === "dragleave") {
			setDragActive(false);
		}
	}, []);

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) {
				handleFile(file);
			}
		},
		[handleFile],
	);

	const displayUrl = previewUrl || currentImageUrl;

	return (
		<div className="space-y-4">
			{displayUrl && (
				<div className="relative inline-block">
					<img
						src={displayUrl}
						alt="תמונת רב"
						className="w-40 h-40 object-cover rounded-xl shadow-md ring-4 ring-gray-100"
					/>
					{onRemove && (
						<button
							type="button"
							onClick={onRemove}
							className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-7 h-7 flex items-center justify-center text-lg hover:bg-red-600 transition-all shadow-md hover:scale-110"
						>
							×
						</button>
					)}
				</div>
			)}

			{/* biome-ignore lint/a11y/noStaticElementInteractions: drag-drop zone for file upload */}
			<div
				onDragEnter={handleDrag}
				onDragLeave={handleDrag}
				onDragOver={handleDrag}
				onDrop={handleDrop}
				className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
					dragActive
						? "border-blue-500 bg-blue-50 scale-[1.02]"
						: "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
				}`}
			>
				{isUploading ? (
					<div className="flex flex-col items-center justify-center gap-3">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
						<span className="text-blue-600 font-medium">מעלה תמונה...</span>
					</div>
				) : (
					<>
						<div className="text-4xl mb-3">📤</div>
						<input
							type="file"
							accept="image/*"
							onChange={handleChange}
							className="hidden"
							id="image-upload"
						/>
						<label
							htmlFor="image-upload"
							className="cursor-pointer inline-block bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-all font-medium shadow-sm hover:shadow-md"
						>
							בחר תמונה להעלאה
						</label>
						<p className="text-sm text-gray-500 mt-3">
							או גרור ושחרר קובץ תמונה לכאן
						</p>
					</>
				)}
			</div>
		</div>
	);
}
