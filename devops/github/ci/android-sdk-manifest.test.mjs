import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseRemotePackages,
	pickArchive,
	resolveCacheCoordinates,
	revisionString,
	selectPackage,
} from "./android-sdk-manifest.mjs";

const ARCHIVE = (url, sha, extra = "") => `
			<archive>
				<complete><size>1000</size><checksum type="sha1">${sha}</checksum><url>${url}</url></complete>
				${extra}
			</archive>`;

const PACKAGE = (path, channel, revision, archives) => `
	<remotePackage path="${path}">
		<revision>${revision}</revision>
		<display-name>${path}</display-name>
		<channelRef ref="${channel}"/>
		<archives>${archives}</archives>
	</remotePackage>`;

const REPOSITORY = `<sdk-repository>${[
		PACKAGE(
			"emulator",
			"channel-2",
			"<major>37</major><minor>3</minor><micro>3</micro>",
			ARCHIVE("emulator-linux_x64-16489710.zip", "aa4d823db841f6b527fe09115cc9defbfaf24a85",
				"<host-os>linux</host-os><host-arch>x64</host-arch>"),
		),
		PACKAGE(
			"emulator",
			"channel-0",
			"<major>37</major><minor>2</minor><micro>12</micro>",
			ARCHIVE("emulator-linux_x64-16428233.zip", "cd7362ea55dfb86a418958138dc396e74165dd01",
				"<host-os>linux</host-os><host-arch>x64</host-arch>") +
				ARCHIVE("emulator-windows_x64-16428233.zip", "488ed747e82de7e9bb5247becd1ac043c7e5e85d",
					"<host-os>windows</host-os><host-arch>x64</host-arch>"),
		),
		PACKAGE(
			"platforms;android-36",
			"channel-0",
			"<major>2</major>",
			ARCHIVE("platform-36_r02.zip", "1111111111111111111111111111111111111111"),
		),
		PACKAGE(
			"build-tools;37.0.0",
			"channel-0",
			"<major>37</major><minor>0</minor><micro>0</micro>",
			ARCHIVE("build-tools_r37-linux.zip", "2222222222222222222222222222222222222222",
				"<host-os>linux</host-os>"),
		),
		PACKAGE(
			"platform-tools",
			"channel-0",
			"<major>36</major><minor>0</minor><micro>2</micro>",
			ARCHIVE("platform-tools_r36.0.2-linux.zip", "3333333333333333333333333333333333333333",
				"<host-os>linux</host-os>"),
		),
	].join("")}</sdk-repository>`;

// The real system-image manifest nests a <min-revision> inside <dependencies>;
// it must not leak into the package revision used by the cache key.
const SYS_IMG = `<sdk-sys-img>
	<remotePackage path="system-images;android-36;google_apis;x86_64">
		<type-details xsi:type="sys-img:sysImgDetailsType"><api-level>36</api-level></type-details>
		<revision><major>7</major></revision>
		<display-name>Google APIs Intel x86_64 Atom System Image</display-name>
		<dependencies>
			<dependency path="emulator"><min-revision><major>35</major><minor>4</minor><micro>9</micro></min-revision></dependency>
		</dependencies>
		<channelRef ref="channel-0"/>
		<archives>${ARCHIVE("x86_64-36_r07.zip", "c6bf44bdcd885bb902b4ba752d111a073ad7a817")}</archives>
	</remotePackage></sdk-sys-img>`;

const COORDINATES = {
	apiLevel: "36",
	target: "google_apis",
	abi: "x86_64",
	buildTools: "37.0.0",
};

test("parseRemotePackages reads channel, revision and archives", () => {
	const packages = parseRemotePackages(REPOSITORY);
	const emulator = selectPackage(packages, "emulator", "channel-0");
	assert.equal(revisionString(emulator.revision), "37.2.12");
	assert.equal(emulator.archives.length, 2);
	assert.equal(emulator.archives[0].hostOs, "linux");
});

test("selectPackage ignores other channels of the same path", () => {
	const packages = parseRemotePackages(REPOSITORY);
	assert.equal(
		revisionString(selectPackage(packages, "emulator", "channel-2").revision),
		"37.3.3",
	);
	assert.throws(() => selectPackage(packages, "emulator", "channel-3"));
});

test("pickArchive selects the linux archive and rejects missing hosts", () => {
	const emulator = selectPackage(
		parseRemotePackages(REPOSITORY),
		"emulator",
		"channel-0",
	);
	assert.equal(pickArchive(emulator, "linux").url, "emulator-linux_x64-16428233.zip");
	assert.throws(() => pickArchive(emulator, "freebsd"));
});

test("resolveCacheCoordinates keys by resolved version, build and checksum", () => {
	const result = resolveCacheCoordinates({
		repositoryXml: REPOSITORY,
		sysImgXml: SYS_IMG,
		...COORDINATES,
	});
	// Stable channel only: 37.2.12, never the 37.3.3 dev-channel build.
	assert.equal(result.emulatorKey, "37.2.12-16428233-cd7362ea");
	assert.equal(
		result.sdkKey,
		"emu37.2.12-cd7362ea-img36r7-c6bf44bd-pl2-11111111-bt37.0.0-22222222-pt36.0.2-33333333",
	);
});

test("resolveCacheCoordinates rotates keys when package content changes", () => {
	const rotated = resolveCacheCoordinates({
		repositoryXml: REPOSITORY.replace("cd7362ea55dfb86a418958138dc396e74165dd01", "dd7362ea55dfb86a418958138dc396e74165dd01"),
		sysImgXml: SYS_IMG,
		...COORDINATES,
	});
	assert.notEqual(
		rotated.sdkKey,
		resolveCacheCoordinates({
			repositoryXml: REPOSITORY,
			sysImgXml: SYS_IMG,
			...COORDINATES,
		}).sdkKey,
	);
});

test("resolveCacheCoordinates fails when a needed package is absent", () => {
	assert.throws(() =>
		resolveCacheCoordinates({
			repositoryXml: REPOSITORY.replace('path="platform-tools"', 'path="other"'),
			sysImgXml: SYS_IMG,
			...COORDINATES,
		}),
	);
});
