interface AutoSaveIndicatorProps {
	isSaving: boolean;
	lastSaved?: Date | null;
	hasChanges: boolean;
	/** Set when the last save attempt failed — the failure takes display priority. */
	saveFailed?: boolean;
}

export function AutoSaveIndicator({
	isSaving,
	lastSaved,
	hasChanges,
	saveFailed,
}: AutoSaveIndicatorProps) {
	return (
		<div className="flex items-center gap-2.5 text-sm px-4 py-2 rounded-lg bg-gray-100/50">
			{isSaving ? (
				<>
					<div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-200 border-t-blue-600" />
					<span className="text-blue-600 font-medium">⏳ שומר...</span>
				</>
			) : saveFailed ? (
				<>
					<div className="h-2.5 w-2.5 rounded-full bg-red-500" />
					<span className="text-red-700 font-medium">השמירה נכשלה</span>
				</>
			) : hasChanges ? (
				<>
					<div className="h-2.5 w-2.5 rounded-full bg-yellow-400 animate-pulse" />
					<span className="text-yellow-700 font-medium">
						יש שינויים שלא נשמרו
					</span>
				</>
			) : lastSaved ? (
				<>
					<div className="h-2.5 w-2.5 rounded-full bg-green-500" />
					<span className="text-green-700 font-medium">
						✓ נשמר ב-{lastSaved.toLocaleTimeString("he-IL")}
					</span>
				</>
			) : null}
		</div>
	);
}
