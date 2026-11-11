import { useCallback, useEffect, useState } from "react";
import { getUploadSettings, setUploadQuota } from "~/server/archive";

type Settings = Awaited<ReturnType<typeof getUploadSettings>>;

export function UploadSettings() {
	const [settings, setSettings] = useState<Settings | null>(null);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const refresh = useCallback(async () => {
		setSettings(await getUploadSettings());
	}, []);
	useEffect(() => {
		void refresh().catch((error: Error) => setMessage(error.message));
	}, [refresh]);
	async function save(gb: number | null, userId?: string) {
		setBusy(true);
		setMessage("");
		try {
			await setUploadQuota({ data: { gb, userId } });
			await refresh();
			setMessage("המכסה נשמרה");
		} catch (error) {
			setMessage((error as Error).message);
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="space-y-6">
			<h1 className="text-3xl font-bold">מכסות אחסון בארכיון</h1>
			<p>
				הגדרת נפח אחסון למחברים ולמנהלי הארכיון. הקבצים של כל מחבר נשמרים
				בתיקייה נפרדת.
			</p>
			{message && <p role="status">{message}</p>}
			{settings && (
				<>
					<QuotaForm
						label="מכסת ברירת מחדל לכל משתמש (GB)"
						value={settings.quota / 1_000_000_000}
						disabled={busy}
						onSave={(gb) => {
							void save(gb);
						}}
					/>
					<p className="text-gray-600">
						1 TB = 1000 GB. שינוי ברירת המחדל חל גם על משתמשים קיימים ללא מכסה
						אישית. הקטנת מכסה אינה מוחקת קבצים קיימים.
					</p>
					<h2 className="text-xl font-semibold">משתמשי הארכיון</h2>
					{settings.users.length === 0 && <p>עדיין אין תיקיות משתמשים.</p>}
					{settings.users.map((user) => (
						<section
							className="bg-white border rounded-xl p-6 space-y-3"
							key={user.userId}
						>
							<h3 className="font-bold">{user.displayName || user.username}</h3>
							<p>
								{(user.allocated / 1_000_000_000).toLocaleString("he-IL")} GB
								בשימוש, כולל העלאות שלא הושלמו
							</p>
							<QuotaForm
								label={`מכסה אישית עבור ${user.username} (GB)`}
								value={(user.quota ?? settings.quota) / 1_000_000_000}
								disabled={busy}
								onSave={(gb) => {
									void save(gb, user.userId);
								}}
							/>
							<button
								className="text-blue-700"
								type="button"
								disabled={busy || user.quota === null}
								onClick={() => {
									void save(null, user.userId);
								}}
							>
								שימוש במכסת ברירת המחדל
							</button>
						</section>
					))}
				</>
			)}
		</div>
	);
}

function QuotaForm({
	label,
	value,
	disabled,
	onSave,
}: {
	label: string;
	value: number;
	disabled: boolean;
	onSave: (gb: number) => void;
}) {
	return (
		<form
			key={value}
			className="flex items-end gap-4 flex-wrap"
			onSubmit={(event) => {
				event.preventDefault();
				const data = new FormData(event.currentTarget);
				onSave(Number(data.get("gb")));
			}}
		>
			<label className="flex flex-col gap-2">
				{label}
				<input
					className="border rounded-lg px-3 py-2"
					name="gb"
					type="number"
					min={0}
					max={100000}
					step={1}
					required
					defaultValue={value}
					disabled={disabled}
				/>
			</label>
			<button
				className="bg-blue-700 text-white rounded-lg px-5 py-2"
				type="submit"
				disabled={disabled}
			>
				שמירה
			</button>
		</form>
	);
}
