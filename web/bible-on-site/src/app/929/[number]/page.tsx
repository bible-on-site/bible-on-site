// import Image from "next/image";
import styles from "./page.module.css";
import "./overiide-globals.css";
import { getPerekByPerekId } from "../../../data/perek-dto";
import { toLetters } from "gematry";
import Breadcrumb from "./components/Breadcrumb";
// perakim are a closed list.
export const dynamicParams = false;

// this reserverd function is a magic for caching
export async function generateStaticParams() {
  // return range of numbers from 1 to 929
  return Array.from({ length: 929 }, (_, i) => i + 1);
}
const Ptuah = () => {
  return <span className={styles.pPtuha} />;
};
const Stuma = () => {
  return <span className={styles.pStuma} />;
};
export default async function Perek({
  params: { number },
}: {
  params: { number: number };
}) {
  const perekId = number;
  const perekObj = await getPerekByPerekId(perekId);
  return (
    <div className="absolute z-6 top-[72px] w-full h-[calc(100vh-72px)]">
      <Breadcrumb perekObj={perekObj} />
      {/* <header className={styles.perekTextHeader}>
        <h1>
          הפרק: {perekObj.source}
          {perekObj.header !== "" && ` - ${perekObj.header}`}
        </h1>
      </header> */}

      <article className={styles.perekText}>
        {perekObj.pesukim.map((pasuk, pasukIdx) => {
          const pasukNumElement = (
            <a className={styles.pasukNum}>{toLetters(pasukIdx + 1)}</a>
          );
          const pasukElement = pasuk.segments.map((segment, segmentIdx) => {
            const key = pasukIdx + "-" + segmentIdx;
            // TODO: merge qris sequnce like in 929/406
            return (
              <>
                <a
                  key={key}
                  className={segment.type == "qri" ? styles.qri : ""}
                >
                  {segment.type == "ktiv" ? (
                    segment.value
                  ) : segment.type == "qri" ? (
                    <>
                      (<label></label>
                      {segment.value})
                    </>
                  ) : segment.type == "ptuha" ? (
                    Ptuah()
                  ) : (
                    Stuma()
                  )}
                </a>
                {segmentIdx === pasuk.segments.length - 1 ||
                (segment &&
                  (segment.type === "ktiv" || segment.type === "qri") &&
                  segment.value.at(segment.value.length - 1) === "־") ? null : (
                  <span> </span>
                )}
              </>
            );
          });
          return (
            <>
              {pasukNumElement}
              <span> </span>
              {pasukElement}
              <span> </span>
            </>
          );
        })}
      </article>
    </div>
  );
}
