import { useCallback, useEffect, useRef, useState } from "react";
import type { Directory } from "~/lib/archive";
import styles from "./archive.module.css";

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

async function api(data?: Record<string, unknown>, directory = "", after = "") {
	const pathname =
		window.location.pathname === "/archive/"
			? "/archive"
			: window.location.pathname;
	const response = await fetch("/archive/api", {
		cache: "no-store",
		headers: {
			"X-Archive-Directory": directory,
			"X-Archive-After": after,
			"X-Archive-Path":
				!directory && pathname.startsWith("/archive/")
					? encodeURIComponent(decodeURIComponent(pathname.slice(8)))
					: "",
		},
		...(data
			? {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(data),
				}
			: {}),
	});
	const result = await response.json();
	if (!response.ok)
		throw Object.assign(new Error(result.error), { status: response.status });
	return result;
}

export function ArchiveArea() {
	const [loginRequired, setLoginRequired] = useState(false);
	const [directory, setDirectory] = useState<Directory | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [cursor, setCursor] = useState("");
	const [history, setHistory] = useState<string[]>([]);
	const [activeDirectory, setActiveDirectory] = useState("");
	const [newFolder, setNewFolder] = useState("");
	const [progress, setProgress] = useState<{
		filename: string;
		percent: number;
	} | null>(null);
	const cancel = useRef(false);
	const request = useRef<AbortController | null>(null);
	const listingRequest = useRef(0);
	const load = useCallback(
		async (directoryId: string, after: string, previous: string[] = []) => {
			const generation = ++listingRequest.current;
			const result: Directory = await api(undefined, directoryId, after);
			if (generation === listingRequest.current) {
				setDirectory(result);
				setLoginRequired(false);
				const path =
					result.path === "/"
						? "/archive"
						: `/archive/${result.path.slice(1).split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
				window.history.replaceState(null, "", path);
				setActiveDirectory(result.id);
				setCursor(after);
				setHistory(previous);
			}
		},
		[],
	);
	const refresh = useCallback(
		() => load(activeDirectory, cursor, history),
		[load, activeDirectory, cursor, history],
	);
	useEffect(() => {
		let active = true;
		void load("", "").catch((e: Error & { status?: number }) => {
			if (!active) return;
			if (e.status === 401) setLoginRequired(true);
			else setError(e.message);
		});
		return () => {
			active = false;
			listingRequest.current++;
			cancel.current = true;
			request.current?.abort();
		};
	}, [load]);

	async function showPage(after: string, previous: string[]) {
		setBusy(true);
		setError("");
		try {
			await load(activeDirectory, after, previous);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	async function openDirectory(id: string) {
		setBusy(true);
		setError("");
		try {
			await load(id, "");
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	async function createFolder() {
		setBusy(true);
		setError("");
		try {
			await api({
				action: "mkdir",
				name: newFolder,
				directory: activeDirectory,
			});
			setNewFolder("");
			await load(activeDirectory, "");
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

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
					directory: activeDirectory,
				});
				try {
					for (
						let offset = 0, part = 1;
						offset < file.size;
						offset += started.partSize, part++
					) {
						if (cancel.current) throw new Error("ההעלאה בוטלה");
						request.current = new AbortController();
						const response = await fetch("/archive/api", {
							method: "PUT",
							headers: {
								"X-Upload-Id": started.id,
								"X-Upload-Part": String(part),
							},
							body: file.slice(offset, offset + started.partSize),
							signal: request.current.signal,
						});
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
			try {
				await load(activeDirectory, "");
			} catch (e) {
				setError((e as Error).message);
			} finally {
				setBusy(false);
			}
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

	if (loginRequired)
		return (
			<section className={styles.card}>
				<h2>כניסה לארכיון</h2>
				<p>יש להיכנס עם שם המשתמש והסיסמה שקיבלתם מצוות האתר.</p>
				<a className={styles.primary} href="/archive/auth/login" rel="nofollow">
					כניסה לחשבון
				</a>
				<p>
					<a href="/archive/auth/admin" rel="nofollow">
						כניסת מנהל
					</a>
				</p>
				<p className={styles.note}>
					הגישה מיועדת לבעלי חשבון שהוגדר מראש. לקבלת חשבון או לאיפוס סיסמה יש
					לפנות לצוות האתר.
				</p>
			</section>
		);
	return (
		<>
			{error && (
				<p className={styles.error} role="alert">
					{error}{" "}
					<a
						href={
							directory?.isAdmin ? "/archive/auth/admin" : "/archive/auth/login"
						}
						rel="nofollow"
					>
						כניסה מחדש
					</a>
				</p>
			)}
			{directory ? (
				<>
					<nav className={styles.toolbar} aria-label="נתיב תיקיות">
						<div className={styles.breadcrumbs}>
							{directory.breadcrumbs.map((crumb, index) => (
								<span key={crumb.id}>
									{index > 0 && " / "}
									<button
										type="button"
										disabled={busy || crumb.id === directory.id}
										onClick={() => void openDirectory(crumb.id)}
									>
										{crumb.name}
									</button>
								</span>
							))}
						</div>
						<bdi dir="ltr">{directory.path}</bdi>
					</nav>
					<section className={styles.card} aria-label="נפח אחסון">
						<div className={styles.toolbar}>
							<strong>נפח אחסון</strong>
							{directory.isAdmin && (
								<a href="/archive-settings">מכסה עבור {directory.quotaName}</a>
							)}
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
						<form
							className={styles.folderForm}
							onSubmit={(event) => {
								event.preventDefault();
								void createFolder();
							}}
						>
							<label>
								שם תיקייה חדשה
								<input
									aria-label="שם תיקייה חדשה"
									value={newFolder}
									maxLength={255}
									disabled={busy}
									onChange={(event) => setNewFolder(event.target.value)}
								/>
							</label>
							<button type="submit" disabled={busy || !newFolder.trim()}>
								יצירת תיקייה
							</button>
						</form>
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
							<h2>{directory.isAdmin ? "תוכן הארכיון" : "הקבצים שלי"}</h2>
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
											{file.kind === "folder" ? (
												<button
													type="button"
													disabled={busy}
													aria-label={`פתיחת תיקייה ${file.filename}`}
													onClick={() => void openDirectory(file.id)}
												>
													📁 {file.filename}
												</button>
											) : (
												<strong dir="auto">{file.filename}</strong>
											)}
											<p className={styles.note}>
												{file.kind === "folder" ? (
													"תיקייה"
												) : (
													<>
														{fileSize(file.size)} ·{" "}
														{file.status === "ready"
															? "מוכן"
															: file.status === "deleting"
																? "ממתין להשלמת המחיקה"
																: "העלאה לא הושלמה"}
													</>
												)}
											</p>
										</div>
										{file.kind !== "folder" && (
											<div className={styles.actions}>
												{file.status === "ready" && (
													<a
														href={`/archive/api?download=${file.id}`}
														rel="nofollow"
														download
													>
														הורדה
													</a>
												)}
												{(directory.isAdmin ||
													file.status === "initializing" ||
													file.status === "uploading") && (
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
															: file.status === "deleting"
																? "ניסיון מחיקה מחדש"
																: "ביטול ופינוי מקום"}
													</button>
												)}
											</div>
										)}
									</li>
								))}
							</ul>
						)}
						{(history.length > 0 || directory.nextCursor) && (
							<div className={styles.toolbar}>
								<button
									type="button"
									disabled={busy || history.length === 0}
									onClick={() => {
										void showPage(
											history[history.length - 1],
											history.slice(0, -1),
										);
									}}
								>
									הקבצים הקודמים
								</button>
								<button
									type="button"
									disabled={busy || !directory.nextCursor}
									onClick={() => {
										if (directory.nextCursor) {
											void showPage(directory.nextCursor, [...history, cursor]);
										}
									}}
								>
									קבצים נוספים
								</button>
							</div>
						)}
					</section>
				</>
			) : (
				<p role="status">טוען את התיקייה...</p>
			)}
		</>
	);
}
