import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type {
	BulletinWhatsAppState,
	WhatsAppAudience,
	WhatsAppAudienceChange,
	WhatsAppConnectionState,
	WhatsAppQueueRequest,
} from "~/lib/bulletin-whatsapp";
import {
	getDailyBulletinWhatsApp,
	queueDailyBulletinWhatsApp,
	updateDailyBulletinWhatsAppAudience,
	verifyDailyBulletinWhatsApp,
} from "~/server/bulletin-whatsapp";

const STATUS_NAMES = {
	queued: "ממתין בתור",
	sending: "בשליחה",
	accepted: "ממתין לאישור שליחה",
	sent: "נשלח לקבוצה",
	failed: "השליחה נכשלה",
	uncertain: "נדרשת בדיקה",
	suppressed: "השליחה נחסמה",
};
const CONNECTION_NAMES: Record<WhatsAppConnectionState, string> = {
	authorized: "החשבון מחובר",
	notAuthorized: "נדרש חיבור החשבון",
	blocked: "החשבון חסום",
	suspended: "השליחה מהחשבון הושהתה",
	sleepMode: "החשבון במצב שינה",
	starting: "החיבור בהפעלה",
	unknown: "החיבור טרם אומת",
};
const ACTIVE = new Set(["queued", "sending", "accepted"]);
const NEW_TEST = new Set(["sent", "failed", "suppressed"]);
const queryKey = (date: string) => ["bulletin-whatsapp", date] as const;
const dateLabel = (date: string) =>
	new Date(date).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

function currentRevision(
	previous: BulletinWhatsAppState | undefined,
	next: BulletinWhatsAppState,
): BulletinWhatsAppState {
	return previous && previous.settings.revision > next.settings.revision
		? previous
		: next;
}

export function BulletinWhatsAppControls({
	date,
	prepared,
	disabled = false,
	onBusyChange,
}: {
	date: string;
	prepared: boolean;
	disabled?: boolean;
	onBusyChange?: (busy: boolean) => void;
}) {
	const client = useQueryClient();
	const [requestedAudience, setRequestedAudience] =
		useState<WhatsAppAudience | null>(null);
	const [confirmReal, setConfirmReal] = useState(false);
	const [newTestForJob, setNewTestForJob] = useState<string | null>(null);
	const [verificationClock, setVerificationClock] = useState(Date.now);
	const attempts = useRef(new Map<string, string>());
	const previousDate = useRef(date);
	const mutationInFlight = useRef(false);
	const whatsapp = useQuery({
		queryKey: queryKey(date),
		queryFn: async () => {
			const next = await getDailyBulletinWhatsApp({ data: date });
			return currentRevision(client.getQueryData(queryKey(date)), next);
		},
		retry: false,
		refetchOnWindowFocus: false,
		refetchInterval: (query) =>
			ACTIVE.has(query.state.data?.job?.status ?? "") ? 5000 : false,
	});
	const cancelReads = () =>
		client.cancelQueries({ queryKey: ["bulletin-whatsapp"] });
	const settle = () => {
		mutationInFlight.current = false;
	};
	const verify = useMutation({
		mutationFn: (value: string) => verifyDailyBulletinWhatsApp({ data: value }),
		retry: false,
		onMutate: cancelReads,
		onSuccess: async (next, verifiedDate) => {
			await cancelReads();
			client.setQueryData<BulletinWhatsAppState>(
				queryKey(verifiedDate),
				(previous) => currentRevision(previous, next),
			);
		},
		onSettled: settle,
	});
	const queue = useMutation({
		mutationFn: (data: WhatsAppQueueRequest) =>
			queueDailyBulletinWhatsApp({ data }),
		retry: false,
		onMutate: cancelReads,
		onSuccess: async (job, request) => {
			await cancelReads();
			setNewTestForJob(null);
			client.setQueryData<BulletinWhatsAppState>(
				queryKey(request.date),
				(previous) =>
					previous &&
					previous.settings.revision === request.expectedRevision &&
					previous.settings.audience === request.expectedAudience
						? {
								...previous,
								job,
								audienceLocked:
									ACTIVE.has(job.status) || job.status === "uncertain",
							}
						: previous,
			);
		},
		onError: (_error, request) =>
			client.invalidateQueries({ queryKey: queryKey(request.date) }),
		onSettled: settle,
	});
	const changeAudience = useMutation({
		mutationFn: (data: WhatsAppAudienceChange) =>
			updateDailyBulletinWhatsAppAudience({ data }),
		retry: false,
		onMutate: cancelReads,
		onSuccess: async (settings) => {
			await cancelReads();
			setRequestedAudience(null);
			setConfirmReal(false);
			setNewTestForJob(null);
			queue.reset();
			client.setQueriesData<BulletinWhatsAppState>(
				{ queryKey: ["bulletin-whatsapp"] },
				(previous) =>
					previous && previous.settings.revision <= settings.revision
						? {
								...previous,
								settings,
								job:
									previous.settings.audience === settings.audience
										? previous.job
										: null,
							}
						: previous,
			);
			await client.invalidateQueries({ queryKey: ["bulletin-whatsapp"] });
		},
		onError: () =>
			client.invalidateQueries({ queryKey: ["bulletin-whatsapp"] }),
		onSettled: settle,
	});
	const { reset: resetQueue } = queue;
	const { reset: resetAudience } = changeAudience;
	const { reset: resetVerification } = verify;
	useEffect(() => {
		if (previousDate.current === date) return;
		previousDate.current = date;
		resetQueue();
		resetAudience();
		resetVerification();
		setRequestedAudience(null);
		setConfirmReal(false);
		setNewTestForJob(null);
	}, [date, resetQueue, resetAudience, resetVerification]);
	const mutationPending =
		queue.isPending || changeAudience.isPending || verify.isPending;
	useEffect(() => {
		onBusyChange?.(mutationPending);
		return () => onBusyChange?.(false);
	}, [mutationPending, onBusyChange]);
	// A failed read must not present a guessed or previously cached audience as current.
	const state = whatsapp.error ? undefined : whatsapp.data;
	const expiresAt = state?.verification.expiresAt;
	useEffect(() => {
		if (!expiresAt) return;
		const delay = Date.parse(expiresAt) - Date.now();
		if (!Number.isFinite(delay) || delay <= 0 || delay >= 2_147_483_647) return;
		const timer = setTimeout(() => setVerificationClock(Date.now()), delay + 1);
		return () => clearTimeout(timer);
	}, [expiresAt]);
	const settings = state?.settings;
	const job = state?.job;
	useEffect(() => {
		if (job?.status === "sent" && job.audience === "real" && job.date === date)
			void client.invalidateQueries({ queryKey: ["daily-bulletin", date] });
	}, [client, date, job]);
	const selected = requestedAudience ?? settings?.audience;
	const unsavedMode = !!settings && selected !== settings.audience;
	const busy = disabled || mutationPending;
	const unresolved =
		!!job && (ACTIVE.has(job.status) || job.status === "uncertain");
	const modeBlocked =
		busy || whatsapp.isFetching || !state || state.audienceLocked || unresolved;
	const realAvailable = !!state?.readiness.canUseReal && !!state.realTarget;
	const currentVerification =
		!!expiresAt &&
		Date.parse(expiresAt) > Math.max(verificationClock, Date.now());
	const freshTest = settings?.audience === "test" && job?.id === newTestForJob;
	const sendBlocked =
		modeBlocked ||
		!prepared ||
		unsavedMode ||
		queue.isError ||
		verify.isError ||
		changeAudience.isError ||
		!state?.readiness.configured ||
		!state.readiness.canSend ||
		!currentVerification ||
		(settings?.audience === "real" && !realAvailable) ||
		(!!job && !freshTest);
	const attemptScope = `${date}:${settings?.audience}:${settings?.revision}`;
	const saveMode = () => {
		if (
			mutationInFlight.current ||
			modeBlocked ||
			!settings ||
			!selected ||
			!unsavedMode ||
			(selected === "real" && (!realAvailable || !confirmReal))
		)
			return;
		mutationInFlight.current = true;
		changeAudience.mutate({
			audience: selected,
			expectedRevision: settings.revision,
			confirmReal,
		});
	};
	const send = () => {
		if (mutationInFlight.current || sendBlocked || !settings) return;
		mutationInFlight.current = true;
		const requestKey =
			attempts.current.get(attemptScope) ?? crypto.randomUUID();
		attempts.current.set(attemptScope, requestKey);
		queue.mutate({
			date,
			requestKey,
			expectedAudience: settings.audience,
			expectedRevision: settings.revision,
		});
	};
	const refresh = async () => {
		const result = await whatsapp.refetch();
		if (!result.error) {
			changeAudience.reset();
			verify.reset();
			const request = queue.variables;
			const current = result.data?.settings;
			if (
				request &&
				request.date === date &&
				request.expectedAudience === current?.audience &&
				request.expectedRevision === current.revision &&
				attempts.current.get(
					`${request.date}:${request.expectedAudience}:${request.expectedRevision}`,
				) === request.requestKey
			) {
				// A deliberate retry reuses the durable request key; active jobs still block it.
				queue.reset();
			}
		}
	};
	return (
		<section
			aria-labelledby="whatsapp-title"
			className="space-y-4 rounded-xl border border-gray-200 bg-white p-6"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 id="whatsapp-title" className="text-xl font-semibold">
						שליחת העלון בווטסאפ
					</h2>
					<p className="mt-1 text-sm text-gray-600">
						שליחת קובץ העלון לקבוצה שנבחרה. קהל הווטסאפ נשמר בנפרד מקהל הדוא"ל.
					</p>
				</div>
				<button
					type="button"
					disabled={busy || whatsapp.isFetching || !state?.readiness.configured}
					className="rounded-lg border border-blue-600 px-4 py-2 text-blue-700 disabled:opacity-50"
					onClick={() => {
						if (
							mutationInFlight.current ||
							busy ||
							!state?.readiness.configured
						)
							return;
						mutationInFlight.current = true;
						verify.mutate(date);
					}}
				>
					{verify.isPending ? "בודק חיבור..." : "בדיקת חיבור"}
				</button>
			</div>
			{whatsapp.isLoading && <p role="status">טוען הגדרות ווטסאפ...</p>}
			{state && settings && (
				<>
					<p className="font-semibold">
						{settings.audience === "test"
							? "מצב ניסיון - קבוצת הניסיון בלבד"
							: "מצב שליחה לקבוצה הרגילה"}
					</p>
					<div className="grid gap-3 sm:grid-cols-2">
						{(
							[
								["test", "קבוצת ניסיון", state.testTarget],
								["real", "הקבוצה הרגילה", state.realTarget],
							] as const
						).map(([audience, title, target]) => (
							<div key={audience} className="min-w-0 rounded-lg bg-gray-50 p-3">
								<p className="text-sm text-gray-600">{title}</p>
								<p className="break-words font-semibold">
									{target?.title ?? "טרם הוגדרה"}
								</p>
								{target?.memberCount !== null &&
									target?.memberCount !== undefined && (
										<p className="text-sm text-gray-600">
											{target.memberCount} משתתפים
										</p>
									)}
								{target?.verifiedAt && (
									<p className="text-sm text-gray-600">
										הקבוצה נבדקה: {dateLabel(target.verifiedAt)}
									</p>
								)}
							</div>
						))}
					</div>
					<div className="rounded-lg border border-gray-200 p-3 text-sm">
						<p className="font-semibold">
							{CONNECTION_NAMES[state.verification.connectionState]}
						</p>
						<p className="text-gray-600">
							{state.verification.checkedAt
								? `בדיקה אחרונה: ${dateLabel(state.verification.checkedAt)}`
								: "החיבור טרם נבדק. אפשר לבדוק אותו באמצעות כפתור בדיקת החיבור."}
						</p>
						{expiresAt && (
							<p
								className={
									currentVerification ? "text-gray-600" : "text-amber-800"
								}
							>
								{currentVerification
									? `הבדיקה בתוקף עד ${dateLabel(expiresAt)}`
									: "תוקף הבדיקה פג. יש לבדוק את החיבור לפני שליחה."}
							</p>
						)}
					</div>
					<div className="flex flex-wrap items-end gap-3">
						<label
							className="flex flex-col gap-2 font-semibold"
							htmlFor="whatsapp-audience"
						>
							יעד השליחה בווטסאפ
							<select
								id="whatsapp-audience"
								value={selected}
								disabled={modeBlocked}
								className="rounded-lg border border-gray-300 px-4 py-2"
								onChange={(event) => {
									if (modeBlocked) return;
									setRequestedAudience(event.target.value as WhatsAppAudience);
									setConfirmReal(false);
									changeAudience.reset();
								}}
							>
								<option value="test">קבוצת ניסיון בלבד</option>
								<option value="real" disabled={!realAvailable}>
									הקבוצה הרגילה
								</option>
							</select>
						</label>
						<button
							type="button"
							onClick={saveMode}
							disabled={
								modeBlocked ||
								!unsavedMode ||
								(selected === "real" && (!realAvailable || !confirmReal))
							}
							className="rounded-lg border border-blue-600 px-4 py-2 text-blue-700 disabled:opacity-50"
						>
							{changeAudience.isPending ? "שומר קבוצה..." : "שמירת יעד הווטסאפ"}
						</button>
					</div>
					{unsavedMode && selected === "real" && (
						<label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900">
							<input
								type="checkbox"
								checked={confirmReal}
								disabled={modeBlocked}
								onChange={(event) => setConfirmReal(event.target.checked)}
							/>
							אני מאשר מעבר לשליחה לקבוצה הרגילה בווטסאפ. העלון הבא יישלח לחברי
							הקבוצה.
						</label>
					)}
					{unsavedMode && <p>יש לשמור את יעד הווטסאפ לפני שליחת העלון.</p>}
					{!realAvailable && (
						<p className="text-sm text-gray-600">
							שליחה לקבוצה הרגילה זמינה לאחר הגדרתה ובדיקת החיבור אליה.
						</p>
					)}
					{state.audienceLocked && (
						<p className="text-amber-800">
							יש משלוח שטרם הסתיים. שינוי הקבוצה חסום עד לבדיקת מצב השליחה.
						</p>
					)}
					{state.readiness.blockers.length > 0 && (
						<div
							role="alert"
							className="rounded-lg bg-amber-50 p-3 text-amber-900"
						>
							<p className="font-semibold">נדרש לפני שליחה בווטסאפ:</p>
							<ul className="list-inside list-disc">
								{state.readiness.blockers.map((blocker) => (
									<li key={blocker}>{blocker}</li>
								))}
							</ul>
						</div>
					)}
				</>
			)}
			{(whatsapp.error ||
				queue.error ||
				changeAudience.error ||
				verify.error) && (
				<div
					role="alert"
					className="space-y-2 rounded-lg bg-red-50 p-3 text-red-800"
				>
					<p>
						{whatsapp.error
							? "לא ניתן לטעון את מצב הווטסאפ. קהל השליחה אינו ידוע כרגע."
							: queue.error
								? "לא התקבלה תשובת שליחה תקינה. שליחה נוספת חסומה עד לבדיקת המשלוח."
								: changeAudience.error
									? "שינוי הקבוצה לא אושר. יש לרענן את המצב לפני פעולה נוספת."
									: "בדיקת החיבור לא הושלמה. אפשר לרענן את המצב או לבדוק שוב."}
					</p>
					<button
						type="button"
						disabled={busy || whatsapp.isFetching}
						onClick={() => void refresh()}
						className="underline"
					>
						רענון מצב הווטסאפ
					</button>
				</div>
			)}
			{job && (
				<div className="space-y-2 rounded-lg bg-gray-50 p-3">
					<p role="status" className="font-semibold">
						{job.audience === "test" ? "ניסיון בווטסאפ" : "משלוח לקבוצה הרגילה"}
						: {STATUS_NAMES[job.status]}
					</p>
					<p className="break-words text-sm text-gray-600">
						מספר משלוח: <bdi>{job.id}</bdi> | נוצר: {dateLabel(job.createdAt)}
					</p>
					{job.sentAt && (
						<p className="text-sm text-gray-600">
							נשלח: {dateLabel(job.sentAt)}
						</p>
					)}
					{job.error && <p>{job.error}</p>}
					<p className="text-sm text-gray-600">
						אישור שליחה מתייחס לפרסום בקבוצה. הוא אינו אישור קריאה של חברי
						הקבוצה.
					</p>
				</div>
			)}
			{job?.status === "uncertain" && (
				<p role="status" className="text-amber-800">
					תוצאת השליחה אינה ודאית. יש לבדוק את הקבוצה ואת יומן השליחה לפני פעולה
					נוספת. שליחה חוזרת חסומה.
				</p>
			)}
			{settings?.audience === "test" &&
				job?.audience === "test" &&
				NEW_TEST.has(job.status) &&
				!freshTest && (
					<button
						type="button"
						disabled={modeBlocked || unsavedMode}
						className="rounded-lg border border-blue-600 px-4 py-2 text-blue-700 disabled:opacity-50"
						onClick={() => {
							if (modeBlocked || unsavedMode) return;
							attempts.current.set(attemptScope, crypto.randomUUID());
							setNewTestForJob(job.id);
							queue.reset();
						}}
					>
						ניסיון ווטסאפ חדש
					</button>
				)}
			{!prepared && (
				<p className="text-sm text-gray-600">
					יש להכין את העלון ואת קובץ ה-PDF לפני השליחה.
				</p>
			)}
			<button
				type="button"
				disabled={sendBlocked}
				onClick={send}
				className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-50"
			>
				{queue.isPending
					? "מוסיף לתור הווטסאפ..."
					: settings?.audience === "real"
						? "שליחת העלון לקבוצה הרגילה"
						: settings?.audience === "test"
							? "שליחת ניסיון בווטסאפ"
							: "שליחת העלון בווטסאפ"}
			</button>
		</section>
	);
}
