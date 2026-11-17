import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContributionArticleLinkGenerator } from "~/components/tanahpedia/ContributionArticleLinkGenerator";

function setup(result: string[] = ["existing-pr"]) {
	const generate = vi.fn().mockResolvedValue(result),
		openPr = vi.fn().mockResolvedValue(undefined);
	render(
		<ContributionArticleLinkGenerator generate={generate} openPr={openPr} />,
	);
	fireEvent.click(screen.getByText("איתור קישורים למאמר"));
	fireEvent.change(screen.getByLabelText("מספר מאמר לאיתור"), {
		target: { value: "17" },
	});
	return { generate, openPr };
}
describe("ordinary PR article-link discovery", () => {
	it("opens the existing or generated ordinary PR for the exact article", async () => {
		const { generate, openPr } = setup();
		fireEvent.submit(screen.getByRole("form", { name: "איתור קישורי מאמר" }));
		await waitFor(() => expect(openPr).toHaveBeenCalledWith("existing-pr"));
		expect(generate).toHaveBeenCalledWith("17");
	});
	it("explains an empty deterministic result without opening an empty PR", async () => {
		const { openPr } = setup([]);
		fireEvent.submit(screen.getByRole("form"));
		expect(await screen.findByRole("status")).toHaveTextContent(
			"לא נמצאו קישורים חדשים",
		);
		expect(openPr).not.toHaveBeenCalled();
	});
	it.each([new Error("Article changed"), "disconnected"])(
		"keeps the article number after failure (%s)",
		async (failure) => {
			const { generate } = setup();
			generate.mockRejectedValue(failure);
			fireEvent.submit(screen.getByRole("form"));
			expect(await screen.findByRole("alert")).toHaveTextContent(
				failure instanceof Error ? failure.message : "איתור הקישורים נכשל",
			);
			expect(screen.getByLabelText("מספר מאמר לאיתור")).toHaveValue("17");
		},
	);
	it("does not start duplicate discovery while a request is running", async () => {
		const { generate } = setup();
		let resolve: (ids: string[]) => void = () => {};
		generate.mockImplementation(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		fireEvent.submit(screen.getByRole("form"));
		fireEvent.submit(screen.getByRole("form"));
		expect(generate).toHaveBeenCalledTimes(1);
		expect(
			screen.getByRole("button", { name: "מאתר קישורים..." }),
		).toBeDisabled();
		await act(async () => resolve([]));
		expect(
			screen.getByRole("button", { name: "איתור ופתיחת PR" }),
		).toBeEnabled();
	});
	it("rejects an invalid target before discovery", async () => {
		const { generate } = setup();
		fireEvent.change(screen.getByLabelText("מספר מאמר לאיתור"), {
			target: { value: "not-an-article" },
		});
		fireEvent.submit(screen.getByRole("form"));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"canonical article ID required",
		);
		expect(generate).not.toHaveBeenCalled();
	});
});
