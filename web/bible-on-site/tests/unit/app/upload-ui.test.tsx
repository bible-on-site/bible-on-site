jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/uploads/auth", () => ({
	SESSION_COOKIE: "upload_session",
	REFRESH_COOKIE: "upload_refresh",
}));

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { cookies } from "next/headers";
import UploadPage, { metadata } from "@/app/upload/page";
import { UploadArea } from "@/app/upload/UploadArea";

let directory: {
	username: string;
	quota: number;
	allocated: number;
	files: { id: string; filename: string; size: number; status: string }[];
};
const reply = (data: unknown, ok = true) => ({ ok, json: async () => data });
beforeEach(() => {
	directory = {
		username: "alice",
		quota: 1000_000_000_000,
		allocated: 0,
		files: [],
	};
	global.fetch = jest.fn(async (_url, options) => {
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
		return reply({ ok: true }) as Response;
	}) as jest.Mock;
	jest.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => jest.restoreAllMocks());
async function mount() {
	render(<UploadArea />);
	await screen.findByText("התיקייה עדיין ריקה. הקבצים שתעלו יופיעו כאן.");
}
function choose(name = "content.bin", content = "123456") {
	fireEvent.change(screen.getByLabelText("בחירת קבצים להעלאה"), {
		target: { files: [new File([content], name)] },
	});
}

it("renders the private landing and opts out of indexing", async () => {
	(cookies as jest.Mock).mockResolvedValue({ has: () => false });
	render(await UploadPage());
	expect(screen.getByRole("link", { name: "כניסה לחשבון" })).toHaveAttribute(
		"href",
		"/upload/auth/login",
	);
	expect(metadata.robots).toMatchObject({ index: false, follow: false });
});
it("renders an authenticated shell for access or refresh cookies", async () => {
	(cookies as jest.Mock).mockResolvedValue({
		has: (name: string) => name === "upload_refresh",
	});
	render(await UploadPage());
	expect(await screen.findByText("alice")).toBeVisible();
});
it("uploads multiple chunks, finalizes and displays safe download links", async () => {
	await mount();
	choose();
	await screen.findByRole("link", { name: "הורדה" });
	expect(
		(fetch as jest.Mock).mock.calls.filter(
			([, options]) => options?.method === "PUT",
		),
	).toHaveLength(2);
	expect(screen.getByRole("link", { name: "הורדה" })).toHaveAttribute(
		"href",
		"/upload/api?download=file",
	);
	expect(screen.getByText("content.bin")).toBeVisible();
});
it("accepts empty files without sending multipart data", async () => {
	await mount();
	choose("empty", "");
	await screen.findByRole("link", { name: "הורדה" });
	expect(
		(fetch as jest.Mock).mock.calls.filter(
			([, options]) => options?.method === "PUT",
		),
	).toHaveLength(0);
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
	(window.confirm as jest.Mock).mockReturnValueOnce(false);
	fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
	expect(screen.getByText("content.bin")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
	await screen.findByText("התיקייה עדיין ריקה. הקבצים שתעלו יופיעו כאן.");
	fireEvent.click(screen.getByRole("button", { name: "רענון" }));
	await waitFor(() =>
		expect(fetch).toHaveBeenCalledWith(
			"/upload/api",
			expect.objectContaining({ cache: "no-store" }),
		),
	);
});
it("shows pending reservations and allows cancellation without deletion confirmation", async () => {
	directory.files = [
		{ id: "pending", filename: "unfinished", size: 8, status: "uploading" },
	];
	directory.quota = 0;
	render(<UploadArea />);
	const cancel = await screen.findByRole("button", {
		name: "ביטול ופינוי מקום",
	});
	expect(screen.getByText(/העלאה לא הושלמה/)).toBeVisible();
	fireEvent.click(cancel);
	await screen.findByText("התיקייה עדיין ריקה. הקבצים שתעלו יופיעו כאן.");
	expect(window.confirm).not.toHaveBeenCalled();
});
it("shows initial load failures and a login link", async () => {
	(fetch as jest.Mock).mockResolvedValue(
		reply({ error: "session expired" }, false),
	);
	render(<UploadArea />);
	expect(await screen.findByRole("alert")).toHaveTextContent("session expired");
	expect(screen.getByRole("link", { name: "כניסה מחדש" })).toHaveAttribute(
		"href",
		"/upload/auth/login",
	);
});
it("reports quota errors before sending content", async () => {
	await mount();
	(fetch as jest.Mock).mockResolvedValueOnce(reply({ error: "quota" }, false));
	choose();
	expect(await screen.findByRole("alert")).toHaveTextContent("quota");
});
it("cancels reservations after chunk errors, even if cleanup is temporarily unavailable", async () => {
	await mount();
	(fetch as jest.Mock)
		.mockResolvedValueOnce(reply({ id: "file", partSize: 4 }))
		.mockResolvedValueOnce(reply({ error: "chunk failed" }, false))
		.mockRejectedValueOnce(new Error("cleanup offline"));
	choose();
	expect(await screen.findByRole("alert")).toHaveTextContent("chunk failed");
	expect(
		(fetch as jest.Mock).mock.calls.some(
			([, options]) =>
				options?.body === JSON.stringify({ action: "remove", id: "file" }),
		),
	).toBe(true);
});
it("aborts an in-flight chunk when cancelled", async () => {
	await mount();
	(fetch as jest.Mock)
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
			(fetch as jest.Mock).mock.calls.some(
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
	render(<UploadArea />);
	const cancel = await screen.findByRole("button", {
		name: "ביטול ופינוי מקום",
	});
	(fetch as jest.Mock).mockRejectedValueOnce(new Error("delete failed"));
	fireEvent.click(cancel);
	expect(await screen.findByRole("alert")).toHaveTextContent("delete failed");
	(fetch as jest.Mock).mockRejectedValueOnce(new Error("refresh failed"));
	fireEvent.click(screen.getByRole("button", { name: "רענון" }));
	await waitFor(() =>
		expect(screen.getByRole("alert")).toHaveTextContent("refresh failed"),
	);
});
it("reports logout failures", async () => {
	await mount();
	(fetch as jest.Mock).mockRejectedValueOnce(new Error("logout failed"));
	fireEvent.click(screen.getByRole("button", { name: "יציאה מהחשבון" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("logout failed");
});
it("handles refresh failure after an upload and cancels active work on unmount", async () => {
	await mount();
	(fetch as jest.Mock)
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
