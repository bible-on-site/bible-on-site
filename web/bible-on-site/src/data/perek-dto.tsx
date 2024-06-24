import { toLetters } from "gematry";
import { sefarim } from "./db/sefarim";
import { Pasuk } from "./db/types";
export interface PerekObj {
  perekId: number;
  perekHeb: string;
  header: string;
  pesukim: Pasuk[];
  helek: string;
  sefer: string;
  source: string;
}
export async function getPerekByPerekId(perekId: number): Promise<PerekObj> {
  if (perekId < 1 || perekId > 929) {
    throw new Error("Invalid perekId: " + perekId);
  }
  const sefer = sefarim.find(
    (sefer) => sefer.perekFrom <= perekId && sefer.perekTo >= perekId
  )!;
  const perekIdx = perekId - sefer.perekFrom;
  const perekNum = perekIdx + 1;
  const perekHeb = toLetters(perekNum);
  const perek = sefer.perakim.at(perekIdx)!;

  debugger;
  return {
    perekId: perekId,
    perekHeb: perekHeb,
    header: perek.header,
    pesukim: perek.pesukim,
    helek: sefer.helek,
    sefer: sefer.name,
    source: `${sefer.name} ${perekHeb}`,
  };
}
