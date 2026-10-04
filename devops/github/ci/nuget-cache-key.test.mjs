import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nugetDependencyHash } from "./nuget-cache-key.mjs";

const project = (version, packageVersion) => `<Project>
	<PropertyGroup>
		<ApplicationDisplayVersion>${version}</ApplicationDisplayVersion>
		<ApplicationVersion Condition="'$(TargetFramework)' == 'android'">${version.replaceAll(".", "")}</ApplicationVersion>
	</PropertyGroup>
	<ItemGroup>
		<PackageReference Include="Example" Version="${packageVersion}" />
	</ItemGroup>
</Project>
`;

const hashOf = (files) => {
	const app = mkdtempSync(join(tmpdir(), "nuget-cache-key-"));
	try {
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(join(app, path, ".."), { recursive: true });
			writeFileSync(join(app, path), content);
		}
		return nugetDependencyHash(app);
	} finally {
		rmSync(app, { recursive: true, force: true });
	}
};

test("app releases keep the NuGet cache key", () => {
	assert.equal(
		hashOf({ "App/App.csproj": project("5.0.111", "1.0.0") }),
		hashOf({ "App/App.csproj": project("5.0.112", "1.0.0") }),
	);
});

test("line endings keep the NuGet cache key", () => {
	assert.equal(
		hashOf({ "App/App.csproj": project("5.0.111", "1.0.0") }),
		hashOf({
			"App/App.csproj": project("5.0.111", "1.0.0").replace(/\n/g, "\r\n"),
		}),
	);
});

test("dependency changes rotate the NuGet cache key", () => {
	assert.notEqual(
		hashOf({ "App/App.csproj": project("5.0.111", "1.0.0") }),
		hashOf({ "App/App.csproj": project("5.0.111", "1.0.1") }),
	);
});

test("build outputs do not affect the NuGet cache key", () => {
	assert.equal(
		hashOf({ "App/App.csproj": project("5.0.111", "1.0.0") }),
		hashOf({
			"App/App.csproj": project("5.0.111", "1.0.0"),
			"App/obj/Copy.csproj": project("5.0.111", "2.0.0"),
		}),
	);
});
