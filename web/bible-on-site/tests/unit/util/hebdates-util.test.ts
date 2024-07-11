import { parseNumericalDateToHebcalDate } from "../../../src/util/hebdates-util";
describe("parseNumericalDateToHebcalDate", () => {
  describe("when leap year", () => {
    describe("when month is 05", () => {
      it("returns Sh'vat", () => {
        const actual = parseNumericalDateToHebcalDate(57840501);
        expect(actual.toString()).toBe("1 Sh'vat 5784");
      });
    });
    describe("when month is 09", () => {
      it("returns Sivan", () => {
        const actual = parseNumericalDateToHebcalDate(57840921);
        expect(actual.toString()).toBe("21 Sivan 5784");
      });
    });
    describe("when month is 13", () => {
      it("returns Adar I", () => {
        const actual = parseNumericalDateToHebcalDate(57841315);
        expect(actual.toString()).toBe("15 Adar I 5784");
      });
    });
    describe("when month is 14", () => {
      it("returns Adar II", () => {
        const actual = parseNumericalDateToHebcalDate(57841420);
        expect(actual.toString()).toBe("20 Adar II 5784");
      });
    });
  });
  describe("when non leap year", () => {
    describe("when month is 05", () => {
      it("returns Sh'vat", () => {
        const actual = parseNumericalDateToHebcalDate(57830501);
        expect(actual.toString()).toBe("1 Sh'vat 5783");
      });
    });
    describe("when month is 09", () => {
      it("returns Sivan", () => {
        const actual = parseNumericalDateToHebcalDate(57830921);
        expect(actual.toString()).toBe("21 Sivan 5783");
      });
    });
    describe("when month is 6", () => {
      it("returns Adar", () => {
        const actual = parseNumericalDateToHebcalDate(57831315);
        expect(actual.toString()).toBe("15 Adar 5783");
      });
    });
  });
});
