import { act, render, screen, waitFor } from "@testing-library/react";
import type { PlaceMapMarker } from "../../../src/lib/tanahpedia/types";
import MapboxPlacesMapClient from "../../../src/app/pedia/components/MapboxPlacesMapClient";

type MapEvent = { features?: { properties?: { index?: number } }[] };
type MapHandler = (event: MapEvent) => void;

const mockMaps: Array<{
	handlers: Record<string, MapHandler>;
	addControl: jest.Mock;
	addSource: jest.Mock;
	addLayer: jest.Mock;
	getCanvas: jest.Mock;
	setCenter: jest.Mock;
	setZoom: jest.Mock;
	fitBounds: jest.Mock;
	remove: jest.Mock;
}> = [];
const mockPopups: Array<{
	setLngLat: jest.Mock;
	setDOMContent: jest.Mock;
	addTo: jest.Mock;
	remove: jest.Mock;
}> = [];
const mockBounds: Array<{ extend: jest.Mock }> = [];
const mockSupported = jest.fn(() => true);
const mockRTLStatus = jest.fn(() => "unavailable");
const mockSetRTLTextPlugin = jest.fn();
const mockMapConstructor = jest.fn().mockImplementation(() => {
	const canvas = { style: { cursor: "" } };
	const map = {
		handlers: {} as Record<string, MapHandler>,
		addControl: jest.fn(),
		addSource: jest.fn(),
		addLayer: jest.fn(),
		getCanvas: jest.fn(() => canvas),
		setCenter: jest.fn(),
		setZoom: jest.fn(),
		fitBounds: jest.fn(),
		remove: jest.fn(),
		on: jest.fn(
			(
				event: string,
				layerOrHandler: string | MapHandler,
				handler?: MapHandler,
			) => {
				map.handlers[event] = handler ?? (layerOrHandler as MapHandler);
			},
		),
	};
	mockMaps.push(map);
	return map;
});
const mockPopupConstructor = jest.fn().mockImplementation(() => {
	const popup = {
		setLngLat: jest.fn(),
		setDOMContent: jest.fn(),
		addTo: jest.fn(),
		remove: jest.fn(),
	};
	popup.setLngLat.mockReturnValue(popup);
	popup.setDOMContent.mockReturnValue(popup);
	popup.addTo.mockReturnValue(popup);
	mockPopups.push(popup);
	return popup;
});
const mockBoundsConstructor = jest.fn().mockImplementation(() => {
	const bounds = { extend: jest.fn() };
	mockBounds.push(bounds);
	return bounds;
});

jest.mock("mapbox-gl", () => ({
	__esModule: true,
	default: {
		supported: mockSupported,
		getRTLTextPluginStatus: mockRTLStatus,
		setRTLTextPlugin: mockSetRTLTextPlugin,
		Map: mockMapConstructor,
		Popup: mockPopupConstructor,
		LngLatBounds: mockBoundsConstructor,
		NavigationControl: jest.fn(),
	},
}));

const jerusalem: PlaceMapMarker = {
	placeId: "jerusalem",
	placeName: "ירושלים",
	modernName: "ירושלים כיום",
	lat: 31.778,
	lng: 35.235,
	entryUniqueName: "ירושלים",
};

beforeEach(() => {
	jest.clearAllMocks();
	mockMaps.length = 0;
	mockPopups.length = 0;
	mockBounds.length = 0;
	mockSupported.mockReturnValue(true);
	mockRTLStatus.mockReturnValue("unavailable");
	process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "test-public-token";
});

afterEach(() => {
	delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
});

it("shows the mapped place with a Hebrew link and cleans up the map", async () => {
	const view = render(<MapboxPlacesMapClient markers={[jerusalem]} />);
	await waitFor(() => expect(mockMaps).toHaveLength(1));
	const map = mockMaps[0];
	expect(mockMapConstructor).toHaveBeenCalledWith(
		expect.objectContaining({
			language: "he",
			config: {
				basemap: expect.objectContaining({
					showPointOfInterestLabels: false,
					showAdminBoundaries: false,
				}),
			},
		}),
	);
	expect(mockSetRTLTextPlugin).toHaveBeenCalled();
	expect(map.setCenter).toHaveBeenCalledWith([jerusalem.lng, jerusalem.lat]);
	expect(map.setZoom).toHaveBeenCalledWith(12.5);

	act(() => map.handlers.load({}));
	expect(map.addSource).toHaveBeenCalledWith(
		"tanahpedia-places",
		expect.objectContaining({
			data: expect.objectContaining({
				features: [
					expect.objectContaining({
						geometry: { type: "Point", coordinates: [35.235, 31.778] },
					}),
				],
			}),
		}),
	);
	expect(map.addLayer).toHaveBeenCalledWith(
		expect.objectContaining({ id: "tanahpedia-place-points", slot: "top" }),
	);

	act(() => map.handlers.mouseenter({}));
	expect(map.getCanvas().style.cursor).toBe("pointer");
	act(() => map.handlers.mouseleave({}));
	expect(map.getCanvas().style.cursor).toBe("");
	act(() => map.handlers.click({ features: [{ properties: { index: 0 } }] }));
	const content = mockPopups[0].setDOMContent.mock.calls[0][0] as HTMLElement;
	expect(content.querySelector("a")?.getAttribute("href")).toBe(
		`/pedia/${encodeURIComponent("ירושלים")}`,
	);
	expect(content.textContent).toContain("ירושלים כיום");

	view.unmount();
	expect(mockPopups[0].remove).toHaveBeenCalled();
	expect(map.remove).toHaveBeenCalled();
});

it("groups coincident places and fits bounds for distinct locations", async () => {
	const other: PlaceMapMarker = {
		...jerusalem,
		placeId: "plain",
		placeName: "מקום ללא ערך",
		modernName: null,
		entryUniqueName: null,
	};
	const north: PlaceMapMarker = {
		...jerusalem,
		placeId: "north",
		lat: 32.8,
		lng: 35.5,
	};
	render(<MapboxPlacesMapClient markers={[jerusalem, other, north]} />);
	await waitFor(() => expect(mockMaps).toHaveLength(1));
	const map = mockMaps[0];
	expect(mockBounds[0].extend).toHaveBeenCalledTimes(3);
	expect(map.fitBounds).toHaveBeenCalledWith(
		mockBounds[0],
		expect.objectContaining({ maxZoom: 12.5 }),
	);
	act(() => map.handlers.load({}));
	expect(map.addSource.mock.calls[0][1].data.features).toHaveLength(2);
	act(() => map.handlers.click({ features: [{ properties: { index: 0 } }] }));
	const content = mockPopups[0].setDOMContent.mock.calls[0][0] as HTMLElement;
	expect(content.querySelectorAll("a")).toHaveLength(1);
	expect(content.querySelector("strong")?.textContent).toBe("מקום ללא ערך");
	act(() => map.handlers.click({ features: [{ properties: { index: 1 } }] }));
	expect(mockPopups[0].remove).toHaveBeenCalled();
	act(() => map.handlers.click({ features: [{ properties: { index: 99 } }] }));
	expect(mockPopups).toHaveLength(2);
});

it("shows a fallback message when Mapbox cannot render", async () => {
	mockSupported.mockReturnValue(false);
	render(<MapboxPlacesMapClient markers={[jerusalem]} />);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"לא ניתן לטעון את המפה כרגע",
	);
	expect(mockMapConstructor).not.toHaveBeenCalled();
});

it("shows the fallback when map initialization fails", async () => {
	mockMapConstructor.mockImplementationOnce(() => {
		throw new Error("WebGL initialization failed");
	});
	render(<MapboxPlacesMapClient markers={[jerusalem]} />);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"לא ניתן לטעון את המפה כרגע",
	);
});

it("does not initialize Mapbox without a public token", () => {
	delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
	render(<MapboxPlacesMapClient markers={[jerusalem]} />);
	expect(mockMapConstructor).not.toHaveBeenCalled();
});

it("keeps an empty map at its default view without reloading the RTL plugin", async () => {
	mockRTLStatus.mockReturnValue("loaded");
	render(<MapboxPlacesMapClient markers={[]} />);
	await waitFor(() => expect(mockMaps).toHaveLength(1));
	const map = mockMaps[0];
	expect(mockSetRTLTextPlugin).not.toHaveBeenCalled();
	expect(map.setCenter).not.toHaveBeenCalled();
	expect(map.fitBounds).not.toHaveBeenCalled();
	act(() => map.handlers.load({}));
	expect(map.addSource.mock.calls[0][1].data.features).toEqual([]);
});

it("ignores incomplete click features without opening a popup", async () => {
	render(<MapboxPlacesMapClient markers={[jerusalem]} />);
	await waitFor(() => expect(mockMaps).toHaveLength(1));
	for (const event of [
		{},
		{ features: [] },
		{ features: [{}] },
		{ features: [{ properties: {} }] },
	]) {
		act(() => mockMaps[0].handlers.click(event));
	}
	expect(mockPopups).toHaveLength(0);
});

it("cancels initialization when unmounted before the Mapbox import resolves", async () => {
	const view = render(<MapboxPlacesMapClient markers={[jerusalem]} />);
	view.unmount();
	await act(async () => {});
	expect(mockMapConstructor).not.toHaveBeenCalled();
});
