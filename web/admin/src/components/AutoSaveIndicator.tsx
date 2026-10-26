interface AutoSaveIndicatorProps {
	/** A commit (server save) is in flight. */
	isSaving: boolean;
	/** The last acknowledged server commit. */
	lastSaved?: Date | null;
	/** Edits not yet committed to the server. */
	hasChanges: boolean;
	/** Set when the last commit failed — takes display priority. */
	saveFailed?: boolean;
	/** Last time the local draft was written to this device. */
	lastDraftAt?: Date | null;
	/** The local draft write itself failed (storage unavailable/full). */
	draftFailed?: boolean;
}

/**
 * Two-track status: the local draft (typed content mirrored on this device)
 * and the authoritative server commit. Edits exist only as a draft until
 * שמור עכשיו commits them, so the indicator always says which track holds
 * the work.
 */
export function AutoSaveIndicator({
	isSaving,
	lastSaved,
	hasChanges,
	saveFailed,
	lastDraftAt,
	draftFailed,
}: AutoSaveIndicatorProps) {
	return (
		<div className="flex items-center gap-2.5 text-sm px-4 py-2 rounded-lg bg-gray-100/50">
			{isSaving ? (
				<>
					<div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-200 border-t-blue-600" />
					<span className="text-blue-600 font-medium">⏳ שומר בשרת...</span>
				</>
			) : saveFailed ? (
				<>
					<div className="h-2.5 w-2.5 rounded-full bg-red-500" />
					<span className="text-red-700 font-medium">השמירה לשרת נכשלה</span>
				</>
			) : hasChanges ? (
				<>
					<div className="h-2.5 w-2.5 rounded-full bg-yellow-400 animate-pulse" />
					<span className="text-yellow-700 font-medium">
						יש שינויים שלא נשמרו בשרת
					</span>
				</>
			) : lastSaved ? (
				<>
					<div className="h-2.5 w-2.5 rounded-full bg-green-500" />
					<span className="text-green-700 font-medium">
						✓ נשמר בשרת ב-{lastSaved.toLocaleTimeString("he-IL")}
					</span>
				</>
			) : null}
			{draftFailed ? (
				<span className="text-red-700 font-medium border-r border-red-200 pr-2.5">
					הטיוטה המקומית נכשלה
				</span>
			) : lastDraftAt ? (
				<span className="text-gray-600 border-r border-gray-200 pr-2.5">
					טיוטה נשמרה במכשיר זה ב-
					{lastDraftAt.toLocaleTimeString("he-IL")}
				</span>
			) : null}
		</div>
	);
}
