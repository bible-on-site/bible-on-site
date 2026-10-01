const mockLoaders: Array<() => Promise<{ default: unknown }>> = [];
const mockMapboxClient = jest.fn(() => null);
const mockLeafletClient = jest.fn(() => null);

jest.mock("next/dynamic", () => ({
	__esModule: true,
	default: (loader: () => Promise<{ default: unknown }>) => {
		mockLoaders.push(loader);
		return () => null;
	},
}));

jest.mock("../../../src/app/pedia/components/MapboxPlacesMapClient", () => ({
	__esModule: true,
	default: mockMapboxClient,
}));

jest.mock("../../../src/app/pedia/components/PlacesMapClient", () => ({
	__esModule: true,
	default: mockLeafletClient,
}));

const originalToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

afterEach(() => {
	if (originalToken === undefined) {
		delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
	} else {
		process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = originalToken;
	}
});

it.each([
	["a Mapbox key is available", "test-public-token", mockMapboxClient],
	["no Mapbox key is available", "", mockLeafletClient],
] as const)("loads the expected map provider when %s", async (_case, token, expected) => {
	process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = token;
	mockLoaders.length = 0;
	await jest.isolateModulesAsync(async () => {
		await import("../../../src/app/pedia/components/TanahpediaPlacesMap");
		expect(mockLoaders).toHaveLength(1);
		expect((await mockLoaders[0]()).default).toBe(expected);
	});
});
