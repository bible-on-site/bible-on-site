import { describe, expect, it } from "vitest";
import { canonicalJson } from "~/lib/canonical-json";

describe("canonicalJson", () => {
	it("serializes objects with sorted keys regardless of input order", () => {
		const a = canonicalJson({ b: 1, a: 2, c: { z: 0, y: 1 } });
		const b = canonicalJson({ c: { y: 1, z: 0 }, a: 2, b: 1 });
		expect(a).toBe(b);
		expect(a).toBe('{"a":2,"b":1,"c":{"y":1,"z":0}}');
	});

	it("drops undefined fields but keeps null", () => {
		expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
	});

	it("serializes arrays preserving order", () => {
		expect(canonicalJson([3, { b: 1, a: 2 }, "x"])).toBe('[3,{"a":2,"b":1},"x"]');
	});

	it("serializes primitives like JSON.stringify", () => {
		expect(canonicalJson(7)).toBe("7");
		expect(canonicalJson("א")).toBe('"א"');
		expect(canonicalJson(true)).toBe("true");
	});
});
