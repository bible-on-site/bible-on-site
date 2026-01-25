interface AutoSaveIndicatorProps {
	isSaving: boolean;
	lastSaved?: Date | null;
	hasChanges: boolean;
}

export function AutoSaveIndicator({
	isSaving,
	lastSaved,
	hasChanges,
}: AutoSaveIndicatorProps) {
	return (
		<div className="flex items-center gap-2 text-sm">
			{isSaving ? (
				<>
					<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
					<span className="text-blue-600">שומר...</span>
				</>
			) : hasChanges ? (
				<>
					<div className="h-2 w-2 rounded-full bg-yellow-500" />
					<span className="text-yellow-600">יש שינויים שלא נשמרו</span>
				</>
			) : lastSaved ? (
				<>
					<div className="h-2 w-2 rounded-full bg-green-500" />
					<span className="text-green-600">
						נשמר לאחרונה ב-{lastSaved.toLocaleTimeString("he-IL")}
					</span>
				</>
			) : null}
		</div>
	);
}
