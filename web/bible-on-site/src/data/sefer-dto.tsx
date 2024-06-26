import { sefarim } from "./db/sefarim";
import { Additionals, Pasuk, SefarimItem } from "./db/types";
export type SeferObj = Additionals | SefarimItem;
export function getSeferByName(
  seferName: string,
  additionalLetter?: string
): SeferObj {
  let sefer: Additionals | SefarimItem = sefarim.find(
    (sefer) => sefer.name === seferName
  )!;
  if (!sefer) {
    throw new Error("Invalid seferName: " + seferName);
  }
  if (additionalLetter) {
    sefer = sefer.additionals.find(
      (additional) => additional.letter === additionalLetter
    )!;
  }
  return sefer;
}
