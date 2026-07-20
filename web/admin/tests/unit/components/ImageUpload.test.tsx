import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageUpload } from "~/components/ImageUpload";

class MockFileReader {
	result: string | ArrayBuffer | null = null;
	onload: ((event: ProgressEvent<FileReader>) => void) | null = null;

	readAsDataURL(file: File) {
		this.result = `data:${file.type};base64,preview`;
		this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
	}
}

function imageFile(name = "portrait.png") {
	return new File(["image"], name, { type: "image/png" });
}

function getFileInput(container: HTMLElement) {
	const input = container.querySelector<HTMLInputElement>("input[type='file']");
	if (input === null) throw new Error("Image upload input was not rendered");
	return input;
}

function getDropZone() {
	const helpText = screen.getByText("או גרור ושחרר קובץ תמונה לכאן");
	const dropZone = helpText.parentElement;
	if (dropZone === null) throw new Error("Image upload drop zone was not rendered");
	return dropZone;
}

describe("ImageUpload", () => {
	beforeEach(() => {
		vi.stubGlobal("FileReader", MockFileReader);
		vi.stubGlobal("alert", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renders the current image and removes it", () => {
		const onRemove = vi.fn();

		render(
			<ImageUpload
				currentImageUrl="https://example.com/rabbi.jpg"
				onUpload={vi.fn()}
				onRemove={onRemove}
			/>,
		);

		expect(screen.getByAltText("תמונת רב")).toHaveAttribute(
			"src",
			"https://example.com/rabbi.jpg",
		);

		fireEvent.click(screen.getByRole("button", { name: "×" }));
		expect(onRemove).toHaveBeenCalledTimes(1);
	});

	it("rejects non-image files", () => {
		const onUpload = vi.fn();
		const { container } = render(<ImageUpload onUpload={onUpload} />);

		fireEvent.change(getFileInput(container), {
			target: { files: [new File(["text"], "notes.txt", { type: "text/plain" })] },
		});

		expect(alert).toHaveBeenCalledWith("יש להעלות קובץ תמונה בלבד");
		expect(onUpload).not.toHaveBeenCalled();
	});

	it("uploads selected images and shows a preview", async () => {
		let resolveUpload: () => void = () => undefined;
		const onUpload = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveUpload = resolve;
				}),
		);

		const { container } = render(<ImageUpload onUpload={onUpload} />);

		const file = imageFile();
		fireEvent.change(getFileInput(container), {
			target: { files: [file] },
		});

		expect(onUpload).toHaveBeenCalledWith(file);
		expect(screen.getByAltText("תמונת רב")).toHaveAttribute(
			"src",
			"data:image/png;base64,preview",
		);
		expect(screen.getByText("מעלה תמונה...")).toBeInTheDocument();

		resolveUpload();
		await waitFor(() =>
			expect(screen.queryByText("מעלה תמונה...")).not.toBeInTheDocument(),
		);
	});

	it("uploads dropped images and highlights the drop zone while dragging", async () => {
		const onUpload = vi.fn(() => Promise.resolve());
		render(<ImageUpload onUpload={onUpload} />);

		const dropZone = getDropZone();
		fireEvent.dragEnter(dropZone);
		expect(dropZone.className).toContain("border-blue-500");
		fireEvent.dragLeave(dropZone);
		expect(dropZone.className).not.toContain("border-blue-500");

		const file = imageFile("drop.png");
		fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

		expect(dropZone.className).not.toContain("border-blue-500");
		await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
	});

	it("clears the preview and reports upload failures", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const onUpload = vi.fn(() => Promise.reject(new Error("upload failed")));
		const { container } = render(<ImageUpload onUpload={onUpload} />);

		fireEvent.change(getFileInput(container), {
			target: { files: [imageFile()] },
		});

		await waitFor(() =>
			expect(alert).toHaveBeenCalledWith("העלאת התמונה נכשלה"),
		);
		expect(consoleError).toHaveBeenCalledWith("Upload failed:", expect.any(Error));
		expect(screen.queryByAltText("תמונת רב")).not.toBeInTheDocument();
	});
});
