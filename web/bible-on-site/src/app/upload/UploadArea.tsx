"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Directory } from "../../../../shared/private-upload";
import styles from "./upload.module.css";

function bytes(value: number) {
	return new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 }).format(
		value / 1_000_000_000,
	);
}

function fileSize(value: number) {
	const units = ["B", "KB", "MB", "GB", "TB"];
	const unit = Math.min(
		units.length - 1,
		value > 0 ? Math.floor(Math.log10(value) / 3) : 0,
	);
	return `${new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 }).format(value / 1000 ** unit)} ${units[unit]}`;
}

async function api(data?: Record<string, unknown>) {
	const response = await fetch(
		data?.action === "logout" ? "/upload/api?logout" : "/upload/api",
		{
			cache: "no-store",
			...(data
				? {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(data),
					}
				: {}),
		},
	);
	const result = await response.json();
	if (!response.ok) throw new Error(result.error);
	return result;
}

export function UploadArea() {
	const [directory, setDirectory] = useState<Directory | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<{
		filename: string;
		percent: number;
	} | null>(null);
	const cancel = useRef(false);
	const request = useRef<AbortController | null>(null);
	const refresh = useCallback(async () => {
		setDirectory(await api());
	}, []);
	useEffect(() => {
		void refresh().catch((e: Error) => setError(e.message));
		return () => {
			cancel.current = true;
			request.current?.abort();
		};
	}, [refresh]);

	async function upload(files: FileList | null) {
		if (!files?.length) return;
		setBusy(true);
		setError("");
		cancel.current = false;
		try {
			for (const file of Array.from(files)) {
				if (cancel.current) break;
				setProgress({ filename: file.name, percent: 0 });
				const started = await api({
					action: "start",
					filename: file.name,
					size: file.size,
				});
				try {
					for (
						let offset = 0, part = 1;
						offset < file.size;
						offset += started.partSize, part++
					) {
						if (cancel.current) throw new Error("ההעלאה בוטלה");
						request.current = new AbortController();
						const response = await fetch(
							`/upload/api?id=${started.id}&part=${part}`,
							{
								method: "PUT",
								body: file.slice(offset, offset + started.partSize),
								signal: request.current.signal,
							},
						);
						if (!response.ok) throw new Error((await response.json()).error);
						setProgress({
							filename: file.name,
							percent: Math.round(
								(100 * Math.min(offset + started.partSize, file.size)) /
									file.size,
							),
						});
					}
					if (cancel.current) throw new Error("ההעלאה בוטלה");
					await api({ action: "complete", id: started.id });
				} catch (e) {
					// If cleanup cannot reach the server, the reserved item remains visible for cancellation.
					await api({ action: "remove", id: started.id }).catch(() => {});
					throw e;
				}
			}
		} catch (e) {
			setError(cancel.current ? "ההעלאה בוטלה" : (e as Error).message);
		} finally {
			request.current = null;
			setProgress(null);
			setBusy(false);
			await refresh().catch((e: Error) => setError(e.message));
		}
	}

	async function remove(id: string) {
		setBusy(true);
		setError("");
		try {
			await api({ action: "remove", id });
			await refresh();
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<div className={styles.toolbar}>
				<span>
					שלום, <b>{directory?.username ?? ""}</b>
				</span>
				<button
					type="button"
					disabled={busy}
					onClick={() => {
						void api({ action: "logout" })
							.then((result) => {
								window.location.assign(result.url);
							})
							.catch((e: Error) => setError(e.message));
					}}
				>
					יציאה מהחשבון
				</button>
			</div>
			{error && (
				<p className={styles.error} role="alert">
					{error}{" "}
					<a href="/upload/auth/login" rel="nofollow">
						כניסה מחדש
					</a>
				</p>
			)}
			{directory ? (
				<>
					<section className={styles.card} aria-label="נפח אחסון">
						<div className={styles.toolbar}>
							<strong>נפח אחסון</strong>
							<span>
								{bytes(directory.allocated)} מתוך {bytes(directory.quota)} GB
							</span>
						</div>
						<meter
							min={0}
							max={Math.max(directory.quota, 1)}
							value={directory.allocated}
							aria-label="נפח בשימוש"
						/>
						<p className={styles.note}>
							הנפח כולל קבצים בתהליך העלאה. כל סוגי הקבצים מתקבלים.
						</p>
					</section>
					<section className={`${styles.card} ${styles.drop}`}>
						<h2>הוספת קבצים לתיקייה</h2>
						<p>אפשר לבחור כמה קבצים יחד, מכל סוג.</p>
						<label className={styles.primary}>
							בחירת קבצים
							<input
								aria-label="בחירת קבצים להעלאה"
								type="file"
								multiple
								disabled={busy}
								onChange={(event) => {
									void upload(event.target.files);
									event.target.value = "";
								}}
							/>
						</label>
						{progress && (
							<div role="status">
								<p>
									{progress.filename} - {progress.percent}%
								</p>
								<progress max={100} value={progress.percent} />
								<button
									type="button"
									onClick={() => {
										cancel.current = true;
										request.current?.abort();
									}}
								>
									ביטול ההעלאה
								</button>
							</div>
						)}
					</section>
					<section className={styles.card}>
						<div className={styles.toolbar}>
							<h2>הקבצים שלי</h2>
							<button
								type="button"
								disabled={busy}
								onClick={() => {
									void refresh().catch((e: Error) => setError(e.message));
								}}
							>
								רענון
							</button>
						</div>
						{directory.files.length === 0 ? (
							<p className={styles.empty}>
								התיקייה עדיין ריקה. הקבצים שתעלו יופיעו כאן.
							</p>
						) : (
							<ul className={styles.files}>
								{directory.files.map((file) => (
									<li key={file.id}>
										<div>
											<strong dir="auto">{file.filename}</strong>
											<p className={styles.note}>
												{fileSize(file.size)} ·{" "}
												{file.status === "ready" ? "מוכן" : "העלאה לא הושלמה"}
											</p>
										</div>
										<div className={styles.actions}>
											{file.status === "ready" && (
												<a
													href={`/upload/api?download=${file.id}`}
													rel="nofollow"
													download
												>
													הורדה
												</a>
											)}
											<button
												type="button"
												disabled={busy}
												onClick={() => {
													if (
														file.status !== "ready" ||
														window.confirm(`למחוק את ${file.filename}?`)
													)
														void remove(file.id);
												}}
											>
												{file.status === "ready"
													? "מחיקה"
													: "ביטול ופינוי מקום"}
											</button>
										</div>
									</li>
								))}
							</ul>
						)}
					</section>
				</>
			) : (
				<p role="status">טוען את התיקייה...</p>
			)}
		</>
	);
}
