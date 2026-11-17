import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ContributionCatalogue } from "~/components/tanahpedia/ContributionComposer";
import {
	ContributionIssueScopeFields,
	ContributionIssueScopeSummary,
} from "~/components/tanahpedia/ContributionIssueScope";
import type { IssueScope } from "~/lib/tanahpedia/contributions";

const id = "00000000-0000-4000-8000-000000000001";
const catalogue: ContributionCatalogue = {
	people: [],
	places: [],
	entities: [],
	targets: [
		{ id, kind: "metadata", label: "שם נוכחי", after: { displayName: "שם" } },
	],
};
function Harness({
	initial,
	disabled,
	changed,
}: {
	initial?: IssueScope;
	disabled: boolean;
	changed: (scope: IssueScope | undefined) => void;
}) {
	const [scope, setScope] = useState(initial);
	return (
		<ContributionIssueScopeFields
			value={scope}
			onChange={(next) => {
				changed(next);
				setScope(next);
			}}
			catalogue={catalogue}
			disabled={disabled}
		/>
	);
}
function show(initial?: IssueScope, disabled = false) {
	const changed = vi.fn();
	render(<Harness initial={initial} disabled={disabled} changed={changed} />);
	return changed;
}

describe("optional issue scope", () => {
	it("keeps free-form issues as the collapsed default", () => {
		show();
		expect(
			screen.getByText("הכוונה לסוכן (רשות)").closest("details"),
		).not.toHaveAttribute("open");
		expect(screen.getByLabelText("סוג השינוי המבוקש")).toHaveValue("");
		expect(
			screen.queryByLabelText("יעד השינוי (רשות)"),
		).not.toBeInTheDocument();
	});
	it("gives an existing selected target a stable field name and a human label", () => {
		show({ kind: "metadata", targetId: id });
		expect(
			screen.getByRole("combobox", { name: "יעד השינוי (רשות)" }),
		).toHaveValue(id);
		expect(screen.getByText("שם נוכחי", { selector: "span" })).toBeVisible();
	});
	it("clears an old target when changing kind and supports article numbers outside the catalogue", () => {
		const changed = show({ kind: "metadata", targetId: id });
		fireEvent.change(screen.getByLabelText("סוג השינוי המבוקש"), {
			target: { value: "article_links" },
		});
		expect(changed).toHaveBeenLastCalledWith({ kind: "article_links" });
		fireEvent.change(screen.getByLabelText("מספר מאמר (רשות)"), {
			target: { value: "123" },
		});
		expect(changed).toHaveBeenLastCalledWith({
			kind: "article_links",
			targetId: "123",
		});
		fireEvent.change(screen.getByLabelText("מספר מאמר (רשות)"), {
			target: { value: "" },
		});
		expect(changed).toHaveBeenLastCalledWith({ kind: "article_links" });
	});
	it("creates a new-entry scope without an existing target and can remove the scope", () => {
		const changed = show({ kind: "article_links", targetId: "123" });
		fireEvent.change(screen.getByLabelText("סוג השינוי המבוקש"), {
			target: { value: "entry" },
		});
		expect(changed).toHaveBeenLastCalledWith({ kind: "entry" });
		expect(screen.queryByLabelText("מספר מאמר (רשות)")).not.toBeInTheDocument();
		expect(
			screen.queryByLabelText("יעד השינוי (רשות)"),
		).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("סוג השינוי המבוקש"), {
			target: { value: "" },
		});
		expect(changed).toHaveBeenLastCalledWith(undefined);
	});
	it("disables both inputs while the form is saving", () => {
		show({ kind: "metadata", targetId: id }, true);
		expect(screen.getByLabelText("סוג השינוי המבוקש")).toBeDisabled();
		expect(screen.getByLabelText("יעד השינוי (רשות)")).toBeDisabled();
	});
	it("shows a saved scope and hides an absent scope", () => {
		const { rerender } = render(
			<ContributionIssueScopeSummary
				scope={{ kind: "article_links", targetId: "123" }}
			/>,
		);
		expect(
			screen.getByRole("region", { name: "תחום הפנייה" }),
		).toHaveTextContent("מאמר 123");
		rerender(
			<ContributionIssueScopeSummary
				scope={{ kind: "metadata", targetId: id }}
			/>,
		);
		expect(
			screen.getByRole("region", { name: "תחום הפנייה" }),
		).toHaveTextContent(id);
		rerender(<ContributionIssueScopeSummary />);
		expect(
			screen.queryByRole("region", { name: "תחום הפנייה" }),
		).not.toBeInTheDocument();
	});
});
