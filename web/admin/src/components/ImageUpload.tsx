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
						className="w-32 h-32 object-cover rounded-lg shadow"
					/>
					{onRemove && (
						<button
							type="button"
							onClick={onRemove}
							className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm hover:bg-red-600 transition-colors"
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
				className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
					dragActive
						? "border-blue-500 bg-blue-50"
						: "border-gray-300 hover:border-gray-400"
				}`}
			>
				{isUploading ? (
					<div className="flex items-center justify-center gap-2">
						<div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
						<span>מעלה תמונה...</span>
					</div>
				) : (
					<>
						<input
							type="file"
							accept="image/*"
							onChange={handleChange}
							className="hidden"
							id="image-upload"
						/>
						<label
							htmlFor="image-upload"
							className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium"
						>
							לחץ להעלאת תמונה
						</label>
						<p className="text-sm text-gray-500 mt-1">
							או גרור ושחרר קובץ תמונה
						</p>
					</>
				)}
			</div>
		</div>
	);
}
