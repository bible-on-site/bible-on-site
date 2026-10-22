import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoveringSourcesEditor } from "~/components/CoveringSourcesEditor";
import type { CoveringSource } from "~/server/covering-sources";
import type { Perek } from "~/server/perakim";

const perakim: Perek[] = [
	{
		id: 1,
		perek_id: 1,
		sefer_id: 1,
		sefer_name: "בראשית",
		perek: 1,
		perek_in_context: 1,
		additional_letter: null,
		pasuk_count: 31,
	},
	{
		id: 2,
		perek_id: 2,
		sefer_id: 1,
		sefer_name: "בראשית",
		perek: 2,
		perek_in_context: 2,
		additional_letter: null,
		pasuk_count: 25,
	},
];

function renderEditor(
	sources: CoveringSource[],
	verified = false,
	handlers: {
		onChange?: (s: CoveringSource[]) => void;
		onVerified?: (v: boolean) => void;
	} = {},
) {
	const onChange = handlers.onChange ?? vi.fn();
	const onVerified = handlers.onVerified ?? vi.fn();
	render(
		<CoveringSourcesEditor
			sources={sources}
			verified={verified}
			perakim={perakim}
			defaultPerekId={1}
			onChange={onChange}
			onVerifiedChange={onVerified}
		/>,
	);
	return { onChange, onVerified };
}

describe("CoveringSourcesEditor", () => {
	it("shows the unknown-coverage state when the set is empty", () => {
		renderEditor([]);

		expect(
			screen.getByText(/כיסוי לא ידוע — המאמר משויך לפרק הראשי בלבד/),
		).toBeInTheDocument();
		expect(screen.getByLabelText("כיסוי מאומת")).toBeDisabled();
	});

	it("summarizes mapped pesukim across perakim", () => {
		renderEditor([
			{ perek_id: 1, pasuk: 5 },
			{ perek_id: 1, pasuk: 7 },
			{ perek_id: 2, pasuk: 3 },
		]);

		expect(screen.getByText("3 פסוקים ב-2 פרקים")).toBeInTheDocument();
	});

	it("adds a row defaulted to the primary perek, keeping authored order", () => {
		const { onChange } = renderEditor([{ perek_id: 2, pasuk: 3 }]);

		fireEvent.click(screen.getByText("הוסף פסוק מכוסה"));

		expect(onChange).toHaveBeenCalledWith([
			{ perek_id: 2, pasuk: 3 },
			{ perek_id: 1, pasuk: 1 },
		]);
	});

	it("bounds pasuk input by the perek's canonical pasuk count", () => {
		renderEditor([{ perek_id: 1, pasuk: 5 }]);

		const input = screen.getByLabelText("פסוק למקור 1");
		expect(input).toHaveAttribute("max", "31");
		expect(screen.getByText("1-31")).toBeInTheDocument();
	});

	it("edits a row's pasuk", () => {
		const { onChange } = renderEditor([{ perek_id: 1, pasuk: 5 }]);

		fireEvent.change(screen.getByLabelText("פסוק למקור 1"), {
			target: { value: "9" },
		});

		expect(onChange).toHaveBeenCalledWith([{ perek_id: 1, pasuk: 9 }]);
	});

	it("switches a row to a different perek", () => {
		const { onChange } = renderEditor([{ perek_id: 1, pasuk: 5 }]);

		fireEvent.change(screen.getByLabelText("פרק למקור 1"), {
			target: { value: "2" },
		});

		expect(onChange).toHaveBeenCalledWith([{ perek_id: 2, pasuk: 5 }]);
	});

	it("edits one row while keeping the other rows unchanged", () => {
		const { onChange } = renderEditor([
			{ perek_id: 1, pasuk: 5 },
			{ perek_id: 2, pasuk: 3 },
		]);

		fireEvent.change(screen.getByLabelText("פסוק למקור 1"), {
			target: { value: "9" },
		});

		expect(onChange).toHaveBeenCalledWith([
			{ perek_id: 1, pasuk: 9 },
			{ perek_id: 2, pasuk: 3 },
		]);
	});

	it("removes a row", () => {
		const { onChange } = renderEditor([
			{ perek_id: 1, pasuk: 5 },
			{ perek_id: 2, pasuk: 3 },
		]);

		fireEvent.click(screen.getByLabelText("הסר מקור 1"));

		expect(onChange).toHaveBeenCalledWith([{ perek_id: 2, pasuk: 3 }]);
	});

	it("flags duplicate coordinates inline", () => {
		renderEditor([
			{ perek_id: 1, pasuk: 5 },
			{ perek_id: 1, pasuk: 5 },
		]);

		expect(screen.getByText(/קיימים מקורות כפולים/)).toBeInTheDocument();
	});

	it("emits the verified toggle when rows exist", () => {
		const { onVerified } = renderEditor([{ perek_id: 1, pasuk: 5 }]);

		fireEvent.click(screen.getByLabelText("כיסוי מאומת"));

		expect(onVerified).toHaveBeenCalledWith(true);
	});

	it("warns that verified coverage requires a mapped pasuk", () => {
		renderEditor([], true);

		expect(
			screen.getByText("כיסוי מאומת דורש לפחות פסוק מכוסה אחד"),
		).toBeInTheDocument();
	});

	it("omits the pasuk bound hint when the perek is not in the list", () => {
		renderEditor([{ perek_id: 999, pasuk: 5 }]);

		const input = screen.getByLabelText("פסוק למקור 1");
		expect(input).not.toHaveAttribute("max");
		expect(screen.queryByText(/^1-\d+$/)).not.toBeInTheDocument();
	});

	it("stores pasuk 0 when the input is cleared", () => {
		const { onChange } = renderEditor([{ perek_id: 1, pasuk: 5 }]);

		fireEvent.change(screen.getByLabelText("פסוק למקור 1"), {
			target: { value: "" },
		});

		expect(onChange).toHaveBeenCalledWith([{ perek_id: 1, pasuk: 0 }]);
	});
});
