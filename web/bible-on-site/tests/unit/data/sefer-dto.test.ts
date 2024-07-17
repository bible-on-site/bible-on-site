import type { Additionals } from "../../../src/data/db/tanah-view-types.ts";
import { getSeferByName } from "../../../src/data/sefer-dto.tsx";

describe("getSeferByName", () => {
  describe("when invalid sefer name", () => {
    it("throws error", () => {
      expect(() => getSeferByName("ספר מקבים")).toThrow(
        "Invalid sefer name: ספר מקבים",
      );
    });
  });
  describe("when invalid additional letter", () => {
    describe("when sefer has other addtionals", () => {
      it("throws error", () => {
        expect(() => getSeferByName("שמואל", "ג")).toThrow(
          "Invalid additional letter: ג",
        );
      });
    });
    describe("when sefer has no other addtionals", () => {
      it("throws error", () => {
        expect(() => getSeferByName("ישעיהו", "ב")).toThrow(
          "Sefer ישעיהו has no addtionals at all and requested additional letter: ב",
        );
      });
    });
  });
  describe("when בראשית", () => {
    const actual = getSeferByName("בראשית");
    it("has name בראשית", () => {
      expect(actual.name).toBe("בראשית");
    });
    it("has helek תורה", () => {
      expect(actual.helek).toBe("תורה");
    });
    it("has perekFrom 1", () => {
      expect(actual.perekFrom).toBe(1);
    });
    it("has perekTo 50", () => {
      expect(actual.perekTo).toBe(50);
    });
    it("has pesukimCount 1533", () => {
      expect(actual.pesukimCount).toBe(1533);
    });
    it("has tanachUsName Genesis", () => {
      expect(actual.tanachUsName).toBe("Genesis");
    });
    it("has 50 perakim", () => {
      expect(actual.perakim).toHaveLength(50);
    });
  });
  describe("when שמואל א", () => {
    const actual = getSeferByName("שמואל", "א") as Additionals;
    it("has name שמואל א", () => {
      expect(actual.name).toBe("שמואל א");
    });
    it("has helek נביאים", () => {
      expect(actual.helek).toBe("נביאים");
    });
    it("has perekFrom 233", () => {
      expect(actual.perekFrom).toBe(233);
    });
    it("has perekTo 263", () => {
      expect(actual.perekTo).toBe(263);
    });
    it("has pesukimCount 811", () => {
      expect(actual.pesukimCount).toBe(811);
    });
    it("has letter א", () => {
      expect(actual.letter).toBe("א");
    });
    it("has tanachUsName I Samuel", () => {
      expect(actual.tanachUsName).toBe("I Samuel");
    });
    it("has 31 perakim", () => {
      expect(actual.perakim).toHaveLength(31);
    });
  });
});
