import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { NavBar } from "@/app/components/NavBar";
import RootLayout from "@/app/layout";
import packageJson from "../../../package.json";

it("passes only the current version string across the navigation client boundary", () => {
	const root = RootLayout({ children: <main /> });
	const body = Children.toArray(root.props.children).find(
		(child) => isValidElement(child) && child.type === "body",
	) as ReactElement<{ children: ReactNode }>;
	const nav = Children.toArray(body.props.children).find(
		(child) => isValidElement(child) && child.type === NavBar,
	) as ReactElement<{ version: string }>;

	// The browser needs this string, rather than the manifest's build scripts
	// and dependency graph. Keep that server/client data contract explicit.
	expect(nav.props).toEqual({ version: packageJson.version });
});
