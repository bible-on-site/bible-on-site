import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest";
import { ArchiveArea } from "~/components/archive/ArchiveArea";
import { ArchivePage } from "~/components/archive/ArchivePage";

let directory: {
	id: string;
	homeId: string;
	path: string;
	quotaName: string;
	isAdmin: boolean;
	breadcrumbs: { id: string; name: string }[];
	username: string;
	quota: number;
	allocated: number;
	nextCursor?: string | null;
	files: {
		id: string;
		filename: string;
		size: number;
		status: string;
		kind?: "file" | "folder";
	}[];
};
const reply = (data: unknown, ok = true) => ({
	ok,
	json: async () => JSON.parse(JSON.stringify(data)),
});
beforeEach(() => {
	vi.clearAllMocks();
	window.history.replaceState(null, "", "/archive");
	directory = {
		id: "home",
		homeId: "home",
		path: "/authors/מחבר א/",
		quotaName: "מחבר א",
		isAdmin: true,
		breadcrumbs: [{ id: "home", name: "מחבר א" }],
		username: "alice",
		quota: 1000_000_000_000,
		allocated: 0,
		files: [],
	};
	global.fetch = vi.fn(async (_url, options) => {
		if (!options?.method) return reply(directory) as Response;
		if (options.method === "PUT") return reply({ ok: true }) as Response;
		const command = JSON.parse(options.body as string);
		if (command.action === "start")
			return reply({ id: "file", partSize: 4 }) as Response;
		if (command.action === "complete")
			directory = {
				...directory,
				files: [
					{ id: "file", filename: "content.bin", size: 6, status: "ready" },
				],
			};
		if (command.action === "remove") directory = { ...directory, files: [] };
		if (command.action === "mkdir") return reply({ id: "dir" }) as Response;
		return reply({ ok: true }) as Response;
	}) as Mock;
	vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());
async function mount() {
	render(<ArchiveArea />);
	await screen.findByText("התיקייה עדיין ריקה. הקבצים שתעלו יופיעו כאן.");
}
function choose(name = "content.bin", content = "123456") {
	fireEvent.change(screen.getByLabelText("בחירת קבצים להעלאה"), {
		target: { files: [new File([content], name)] },
	});
}
function dropZone() {
	return screen.getByRole("region", { name: "הוספת קבצים לתיקייה" });
}
function fileEntry(file: File) {
	return {
		isFile: true,
		isDirectory: false,
		name: file.name,
		file: (resolve: (file: File) => void) => resolve(file),
	} as unknown as FileSystemEntry;
}
function dirEntry(name: string, children: FileSystemEntry[]) {
	let read = false;
	return {
		isFile: false,
		isDirectory: true,
		name,
		createReader: () => ({
			readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
				resolve(read ? [] : children);
				read = true;
			},
		}),
	} as unknown as FileSystemEntry;
}
function dragData(entries: FileSystemEntry[]) {
	return {
		items: entries.map((entry) => ({
			kind: "file",
			webkitGetAsEntry: () => entry,
		})),
		files: [],
		types: ["Files"],
		dropEffect: "",
	};
}
function commandsSent(action: string) {
	return (fetch as Mock).mock.calls
		.map(([, options]) =>
			typeof options?.body === "string" ? JSON.parse(options.body) : null,
		)
		.filter((body) => body?.action === action);
}

it("renders the private login when no session exists", async () => {
	(fetch as Mock).mockResolvedValueOnce({
		ok: false,
		status: 401,
		json: async () => ({ error: "login" }),
	});
	render(<ArchivePage />);
	expect(
		await screen.findByRole("link", { name: "כניסה לחשבון" }),
	).toHaveAttribute("href", "/archive/auth/login");
	expect(screen.getByRole("link", { name: "כניסת מנהל" })).toHaveAttribute(
		"href",
		"/archive/auth/admin",
	);
});
it("uploads multiple chunks, finalizes and displays safe download links", async () => {
	await mount();
	choose();
	await screen.findByRole("link", { name: "הורדה" });
	expect(
		(fetch as Mock).mock.calls.filter(
			([, options]) => options?.method === "PUT",
		),
	).toHaveLength(2);
	expect(screen.getByRole("link", { name: "הורדה" })).toHaveAttribute(
		"href",
		"/archive/api?download=file",
	);
	expect(screen.getByText("content.bin")).toBeVisible();
});
it("accepts empty files without sending multipart data", async () => {
	await mount();
	choose("empty", "");
	await screen.findByRole("link", { name: "הורדה" });
	expect(
		(fetch as Mock).mock.calls.filter(
			([, options]) => options?.method === "PUT",
		),
	).toHaveLength(0);
});
it("uploads files dropped onto the panel into the displayed directory", async () => {
	await mount();
	const entries = [
		fileEntry(new File(["aaa"], "first.bin")),
		fileEntry(new File(["bbb"], "second.bin")),
	];
	await act(async () => {
		fireEvent.drop(dropZone(), { dataTransfer: dragData(entries) });
	});
	await waitFor(() => expect(commandsSent("complete")).toHaveLength(2));
	expect(commandsSent("start")).toEqual([
		expect.objectContaining({ filename: "first.bin", directory: "home" }),
		expect.objectContaining({ filename: "second.bin", directory: "home" }),
	]);
});
it("highlights the panel while files are dragged over it and resets on leave or drop", async () => {
	await mount();
	const zone = dropZone();
	const files = { dataTransfer: { types: ["Files"], dropEffect: "" } };
	fireEvent.dragEnter(zone, files);
	expect(
		screen.getByText("שחררו כדי להעלות לתיקייה הנוכחית"),
	).toBeVisible();
	// A nested child fires another enter/leave pair without clearing the state.
	fireEvent.dragEnter(zone, files);
	fireEvent.dragLeave(zone, files);
	expect(
		screen.getByText("שחררו כדי להעלות לתיקייה הנוכחית"),
	).toBeVisible();
	fireEvent.dragLeave(zone, files);
	expect(
		screen.getByText(/אפשר לבחור או לגרור לכאן כמה קבצים יחד/),
	).toBeVisible();
	fireEvent.dragEnter(zone, files);
	await act(async () => {
		fireEvent.drop(zone, { dataTransfer: dragData([]) });
	});
	expect(
		screen.getByText(/אפשר לבחור או לגרור לכאן כמה קבצים יחד/),
	).toBeVisible();
});
it("ignores drags that do not carry files", async () => {
	await mount();
	const calls = (fetch as Mock).mock.calls.length;
	fireEvent.dragEnter(dropZone(), {
		dataTransfer: { types: ["text/plain"] },
	});
	await act(async () => {
		fireEvent.drop(dropZone(), {
			dataTransfer: { items: [], files: [], types: ["text/plain"] },
		});
	});
	expect(screen.queryByText("שחררו כדי להעלות לתיקייה הנוכחית")).toBeNull();
	expect((fetch as Mock).mock.calls.length).toBe(calls);
});
it("rejects new drops while another operation is still busy", async () => {
	await mount();
	let releaseStart: (response: Response) => void = () => {};
	(fetch as Mock).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				releaseStart = resolve;
			}),
	);
	choose();
	await screen.findByRole("button", { name: "ביטול ההעלאה" });
	await act(async () => {
		fireEvent.drop(dropZone(), {
			dataTransfer: dragData([fileEntry(new File(["x"], "late.bin"))]),
		});
	});
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"יש להמתין לסיום הפעולה הנוכחית",
	);
	expect(commandsSent("start")).toHaveLength(1);
	await act(async () => {
		releaseStart(reply({ id: "file", partSize: 4 }) as Response);
	});
	await screen.findByRole("link", { name: "הורדה" });
});
it("prevents the browser from opening files dropped anywhere on the page", async () => {
	await mount();
	expect(
		fireEvent.dragOver(document.body, {
			dataTransfer: { types: ["Files"] },
		}),
	).toBe(false);
	expect(
		fireEvent.drop(document.body, {
			dataTransfer: { types: ["Files"], items: [], files: [] },
		}),
	).toBe(false);
	// Non-file drags keep their default behavior (e.g. text into inputs).
	expect(
		fireEvent.dragOver(document.body, {
			dataTransfer: { types: ["text/plain"] },
		}),
	).toBe(true);
});
it("creates archive folders for dropped directories and uploads nested files", async () => {
	await mount();
	const entries = [
		dirEntry("חומרים", [
			fileEntry(new File(["x"], "nested.bin")),
			dirEntry("עמוק", [fileEntry(new File(["y"], "deep.bin"))]),
		]),
		fileEntry(new File(["z"], "loose.bin")),
	];
	await act(async () => {
		fireEvent.drop(dropZone(), { dataTransfer: dragData(entries) });
	});
	await waitFor(() => expect(commandsSent("complete")).toHaveLength(3));
	expect(commandsSent("mkdir")).toEqual([
		{ action: "mkdir", name: "חומרים", directory: "home" },
		{ action: "mkdir", name: "עמוק", directory: "dir" },
	]);
	expect(commandsSent("start")).toEqual([
		expect.objectContaining({ filename: "nested.bin", directory: "dir" }),
		expect.objectContaining({ filename: "deep.bin", directory: "dir" }),
		expect.objectContaining({ filename: "loose.bin", directory: "home" }),
	]);
});
it("uploads into a same-named existing folder when creation reports a conflict", async () => {
	directory.files = [
		{
			id: "existing",
			filename: "חומרים",
			size: 0,
			status: "ready",
			kind: "folder",
		},
	];
	render(<ArchiveArea />);
	await screen.findByRole("button", { name: "פתיחת תיקייה חומרים" });
	(fetch as Mock).mockResolvedValueOnce({
		ok: false,
		status: 409,
		json: async () => ({ error: "conflict" }),
	} as Response);
	await act(async () => {
		fireEvent.drop(dropZone(), {
			dataTransfer: dragData([
				dirEntry("חומרים", [fileEntry(new File(["x"], "nested.bin"))]),
			]),
		});
	});
	await waitFor(() => expect(commandsSent("complete")).toHaveLength(1));
	expect(commandsSent("start")).toEqual([
		expect.objectContaining({ filename: "nested.bin", directory: "existing" }),
	]);
	expect(screen.queryByRole("alert")).toBeNull();
});
it("reports dropped folders it cannot create and still uploads loose files", async () => {
	await mount();
	(fetch as Mock).mockResolvedValueOnce({
		ok: false,
		status: 403,
		json: async () => ({ error: "denied" }),
	} as Response);
	await act(async () => {
		fireEvent.drop(dropZone(), {
			dataTransfer: dragData([
				dirEntry("אסור", [fileEntry(new File(["x"], "nested.bin"))]),
				fileEntry(new File(["y"], "ok.bin")),
			]),
		});
	});
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"לא ניתן ליצור את התיקיות: אסור",
	);
	await waitFor(() => expect(commandsSent("complete")).toHaveLength(1));
	expect(commandsSent("start")).toEqual([
		expect.objectContaining({ filename: "ok.bin", directory: "home" }),
	]);
});
it("falls back to item files and the flat file list when no entries exist", async () => {
	await mount();
	await act(async () => {
		fireEvent.drop(dropZone(), {
			dataTransfer: {
				items: [
					{
						kind: "file",
						webkitGetAsEntry: () => null,
						getAsFile: () => new File(["b"], "entryless.bin"),
					},
					{ kind: "string" },
				],
				files: [new File(["a"], "fallback.bin")],
				types: ["Files"],
			},
		});
	});
	await waitFor(() => expect(commandsSent("complete")).toHaveLength(1));
	expect(commandsSent("start")).toEqual([
		expect.objectContaining({ filename: "entryless.bin", directory: "home" }),
	]);
});
it("ignores empty file selections", async () => {
	await mount();
	fireEvent.change(screen.getByLabelText("בחירת קבצים להעלאה"), {
		target: { files: null },
	});
	expect(fetch).toHaveBeenCalledTimes(1);
});
it("refreshes the directory and removes ready files after confirmation", async () => {
	await mount();
	choose();
	await screen.findByRole("link", { name: "הורדה" });
	(window.confirm as Mock).mockReturnValueOnce(false);
	fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
	expect(screen.getByText("content.bin")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
	await screen.findByText("התיקייה עדיין ריקה. הקבצים שתעלו יופיעו כאן.");
	fireEvent.click(screen.getByRole("button", { name: "רענון" }));
	await waitFor(() =>
		expect(fetch).toHaveBeenCalledWith(
			"/archive/api",
			expect.objectContaining({ cache: "no-store" }),
		),
	);
});
it("shows pending reservations and allows cancellation without deletion confirmation", async () => {
	directory.files = [
		{ id: "pending", filename: "unfinished", size: 8, status: "uploading" },
	];
	directory.quota = 0;
	render(<ArchiveArea />);
	const cancel = await screen.findByRole("button", {
		name: "ביטול ופינוי מקום",
	});
	expect(screen.getByText(/העלאה לא הושלמה/)).toBeVisible();
	fireEvent.click(cancel);
	await screen.findByText("התיקייה עדיין ריקה. הקבצים שתעלו יופיעו כאן.");
	expect(window.confirm).not.toHaveBeenCalled();
});
it("shows initial load failures and a login link", async () => {
	(fetch as Mock).mockResolvedValue(reply({ error: "session expired" }, false));
	render(<ArchiveArea />);
	expect(await screen.findByRole("alert")).toHaveTextContent("session expired");
	expect(screen.getByRole("link", { name: "כניסה מחדש" })).toHaveAttribute(
		"href",
		"/archive/auth/login",
	);
});
it("reports quota errors before sending content", async () => {
	await mount();
	(fetch as Mock).mockResolvedValueOnce(reply({ error: "quota" }, false));
	choose();
	expect(await screen.findByRole("alert")).toHaveTextContent("quota");
});
it("cancels reservations after chunk errors, even if cleanup is temporarily unavailable", async () => {
	await mount();
	(fetch as Mock)
		.mockResolvedValueOnce(reply({ id: "file", partSize: 4 }))
		.mockResolvedValueOnce(reply({ error: "chunk failed" }, false))
		.mockRejectedValueOnce(new Error("cleanup offline"));
	choose();
	expect(await screen.findByRole("alert")).toHaveTextContent("chunk failed");
	expect(
		(fetch as Mock).mock.calls.some(
			([, options]) =>
				options?.body === JSON.stringify({ action: "remove", id: "file" }),
		),
	).toBe(true);
});
it("aborts an in-flight chunk when cancelled", async () => {
	await mount();
	(fetch as Mock)
		.mockResolvedValueOnce(reply({ id: "file", partSize: 4 }))
		.mockImplementationOnce(
			(_url, options) =>
				new Promise((_resolve, reject) =>
					options.signal.addEventListener("abort", () =>
						reject(new Error("aborted")),
					),
				),
		);
	choose();
	const cancel = await screen.findByRole("button", { name: "ביטול ההעלאה" });
	await waitFor(() =>
		expect(
			(fetch as Mock).mock.calls.some(
				([, options]) => options?.method === "PUT",
			),
		).toBe(true),
	);
	fireEvent.click(cancel);
	expect(await screen.findByRole("alert")).toHaveTextContent("ההעלאה בוטלה");
});
it("reports deletion and refresh errors", async () => {
	directory.files = [
		{ id: "pending", filename: "unfinished", size: 8, status: "uploading" },
	];
	render(<ArchiveArea />);
	const cancel = await screen.findByRole("button", {
		name: "ביטול ופינוי מקום",
	});
	(fetch as Mock).mockRejectedValueOnce(new Error("delete failed"));
	fireEvent.click(cancel);
	expect(await screen.findByRole("alert")).toHaveTextContent("delete failed");
	(fetch as Mock).mockRejectedValueOnce(new Error("refresh failed"));
	fireEvent.click(screen.getByRole("button", { name: "רענון" }));
	await waitFor(() =>
		expect(screen.getByRole("alert")).toHaveTextContent("refresh failed"),
	);
});
it("reports logout failures", async () => {
	await mount();
	(fetch as Mock).mockRejectedValueOnce(new Error("logout failed"));
	fireEvent.click(screen.getByRole("button", { name: "יציאה מהחשבון" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("logout failed");
});
it("handles refresh failure after an upload and cancels active work on unmount", async () => {
	await mount();
	(fetch as Mock)
		.mockResolvedValueOnce(reply({ id: "file", partSize: 4 }))
		.mockResolvedValueOnce(reply({}))
		.mockResolvedValueOnce(reply({}))
		.mockResolvedValueOnce(reply({}))
		.mockRejectedValueOnce(new Error("refresh unavailable"));
	choose();
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"refresh unavailable",
	);
	await act(async () => {});
});

it("pages through bounded directory results and returns to the previous page", async () => {
	global.fetch = vi.fn(async (_url, options) =>
		reply({
			...directory,
			nextCursor: options?.headers?.["X-Archive-After"] ? null : "next",
		}),
	) as Mock;
	render(<ArchiveArea />);
	const next = await screen.findByRole("button", { name: "קבצים נוספים" });
	fireEvent.click(next);
	await waitFor(() =>
		expect(fetch).toHaveBeenCalledWith(
			"/archive/api",
			expect.objectContaining({
				headers: {
					"X-Archive-Directory": "home",
					"X-Archive-After": "next",
					"X-Archive-Path": "",
				},
			}),
		),
	);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "הקבצים הקודמים" }),
		).toBeEnabled(),
	);
	fireEvent.click(screen.getByRole("button", { name: "הקבצים הקודמים" }));
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "הקבצים הקודמים" }),
		).toBeDisabled(),
	);
});
it("shows durable pending deletions and lets their owner retry cleanup", async () => {
	directory.files = [
		{ id: "pending", filename: "deleted.bin", size: 8, status: "deleting" },
	];
	render(<ArchiveArea />);
	const retry = await screen.findByRole("button", {
		name: "ניסיון מחיקה מחדש",
	});
	expect(screen.getByText(/ממתין להשלמת המחיקה/)).toBeVisible();
	expect(screen.queryByRole("link", { name: "הורדה" })).not.toBeInTheDocument();
	fireEvent.click(retry);
	await screen.findByText("התיקייה עדיין ריקה. הקבצים שתעלו יופיעו כאן.");
});

it("returns to the newest page after uploading from an older page", async () => {
	directory.nextCursor = "next";
	await mount();
	(fetch as Mock).mockResolvedValueOnce(
		reply({ ...directory, nextCursor: null }),
	);
	fireEvent.click(screen.getByRole("button", { name: "קבצים נוספים" }));
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "הקבצים הקודמים" }),
		).toBeEnabled(),
	);
	choose();
	await screen.findByRole("link", { name: "הורדה" });
	expect(screen.getByRole("button", { name: "הקבצים הקודמים" })).toBeDisabled();
	const reads = (fetch as Mock).mock.calls.filter(
		([, options]) => !options?.method,
	);
	expect(reads[reads.length - 1][0]).toBe("/archive/api");
});
it("keeps the current page available when a page request fails", async () => {
	directory.nextCursor = "next";
	await mount();
	(fetch as Mock).mockRejectedValueOnce(new Error("page failed"));
	fireEvent.click(screen.getByRole("button", { name: "קבצים נוספים" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("page failed");
});

it("archivers see only their home navigation and have no delete or admin links", async () => {
	directory.isAdmin = false;
	directory.files = [
		{ id: "ready", filename: "protected.bin", size: 3, status: "ready" },
	];
	render(<ArchiveArea />);
	await screen.findByRole("link", { name: "הורדה" });
	expect(
		screen.queryByRole("button", { name: "מחיקה" }),
	).not.toBeInTheDocument();
	expect(
		screen.queryByRole("link", { name: "חזרה לניהול" }),
	).not.toBeInTheDocument();
	expect(
		screen.queryByRole("link", { name: "מכסות אחסון" }),
	).not.toBeInTheDocument();
	expect(
		screen.getByRole("navigation", { name: "נתיב תיקיות" }),
	).toHaveTextContent("מחבר א");
	expect(decodeURIComponent(window.location.pathname)).toBe(
		"/archive/authors/מחבר א",
	);
});
it("creates folders within the displayed directory and opens folder entries", async () => {
	await mount();
	fireEvent.change(screen.getByLabelText("שם תיקייה חדשה"), {
		target: { value: "חומרים" },
	});
	fireEvent.click(screen.getByRole("button", { name: "יצירת תיקייה" }));
	await waitFor(() =>
		expect(fetch).toHaveBeenCalledWith(
			"/archive/api",
			expect.objectContaining({
				body: JSON.stringify({
					action: "mkdir",
					name: "חומרים",
					directory: "home",
				}),
			}),
		),
	);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "יצירת תיקייה" })).toBeDisabled(),
	);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "רענון" })).toBeEnabled(),
	);
	directory.files = [
		{
			id: "nested",
			filename: "חומרים",
			size: 0,
			status: "ready",
			kind: "folder",
		},
	];
	fireEvent.click(screen.getByRole("button", { name: "רענון" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "פתיחת תיקייה חומרים" }),
	);
	await waitFor(() =>
		expect(fetch).toHaveBeenCalledWith(
			"/archive/api",
			expect.objectContaining({
				headers: expect.objectContaining({ "X-Archive-Directory": "nested" }),
			}),
		),
	);
});

it("treats the trailing-slash archive URL as the archiver home", async () => {
	directory.isAdmin = false;
	window.history.replaceState(null, "", "/archive/");
	await mount();
	expect(fetch).toHaveBeenCalledWith(
		"/archive/api",
		expect.objectContaining({
			headers: expect.objectContaining({ "X-Archive-Path": "" }),
		}),
	);
});

it("shows completed empty files without a negative size", async () => {
	directory.files = [
		{ id: "empty", filename: "empty.bin", size: 0, status: "ready" },
	];
	render(<ArchiveArea />);
	expect(await screen.findByText(/0 B/)).toBeVisible();
});
it("keeps the current folder available when opening another folder fails", async () => {
	directory.files = [
		{
			id: "nested",
			filename: "חומרים",
			size: 0,
			status: "ready",
			kind: "folder",
		},
	];
	render(<ArchiveArea />);
	const open = await screen.findByRole("button", {
		name: "פתיחת תיקייה חומרים",
	});
	vi.mocked(fetch).mockRejectedValueOnce(new Error("folder unavailable"));
	fireEvent.click(open);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"folder unavailable",
	);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "רענון" })).toBeEnabled(),
	);
});
it("preserves a new folder name when creation fails", async () => {
	await mount();
	fireEvent.change(screen.getByLabelText("שם תיקייה חדשה"), {
		target: { value: "חומרים" },
	});
	vi.mocked(fetch).mockRejectedValueOnce(new Error("cannot create folder"));
	fireEvent.click(screen.getByRole("button", { name: "יצירת תיקייה" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"cannot create folder",
	);
	expect(screen.getByLabelText("שם תיקייה חדשה")).toHaveValue("חומרים");
});
it("navigates breadcrumbs back to the permitted home", async () => {
	directory = {
		...directory,
		id: "nested",
		path: "/authors/מחבר א/חומרים/",
		breadcrumbs: [
			{ id: "home", name: "מחבר א" },
			{ id: "nested", name: "חומרים" },
		],
	};
	render(<ArchiveArea />);
	const home = await screen.findByRole("button", { name: "מחבר א" });
	directory = {
		...directory,
		id: "home",
		path: "/authors/מחבר א/",
		breadcrumbs: [{ id: "home", name: "מחבר א" }],
	};
	fireEvent.click(home);
	await waitFor(() =>
		expect(fetch).toHaveBeenCalledWith(
			"/archive/api",
			expect.objectContaining({
				headers: expect.objectContaining({ "X-Archive-Directory": "home" }),
			}),
		),
	);
});
it("does not let a delayed refresh replace a newly opened folder", async () => {
	directory.files = [
		{
			id: "nested",
			filename: "חומרים",
			size: 0,
			status: "ready",
			kind: "folder",
		},
	];
	render(<ArchiveArea />);
	await screen.findByRole("button", { name: "פתיחת תיקייה חומרים" });
	let finish: (response: Response) => void = () => {};
	const stale = JSON.parse(JSON.stringify(directory));
	vi.mocked(fetch).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	fireEvent.click(screen.getByRole("button", { name: "רענון" }));
	vi.mocked(fetch).mockResolvedValueOnce(
		reply({
			...directory,
			id: "nested",
			path: "/authors/מחבר א/חומרים/",
			files: [],
			breadcrumbs: [
				{ id: "home", name: "מחבר א" },
				{ id: "nested", name: "חומרים" },
			],
		}) as Response,
	);
	fireEvent.click(screen.getByRole("button", { name: "פתיחת תיקייה חומרים" }));
	await screen.findByText("/authors/מחבר א/חומרים/");
	await act(async () => {
		finish(reply(stale) as Response);
	});
	expect(screen.getByText("/authors/מחבר א/חומרים/")).toBeVisible();
});
it("ignores a late initial-login failure after unmount", async () => {
	let reject: (reason: Error) => void = () => {};
	vi.mocked(fetch).mockImplementationOnce(
		() =>
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
	);
	const view = render(<ArchiveArea />);
	view.unmount();
	await act(async () => {
		reject(new Error("late failure"));
	});
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
