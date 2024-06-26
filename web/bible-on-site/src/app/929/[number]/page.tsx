// import Image from "next/image";
import styles from "./page.module.css";
import "./overiide-globals.css";
import { getPerekByPerekId } from "../../../data/perek-dto";
import { toLetters } from "gematry";
import Breadcrumb from "./components/Breadcrumb";
import { Suspense } from "react";
import React from "react";
import {
  createSearchParamsCache,
  parseAsBoolean,
  parseAsString,
} from "nuqs/server";
import { Ptuah } from "./components/Ptuha";
import { Stuma } from "./components/Stuma";
import SeferComposite from "./components/SeferComposite";
// perakim are a closed list.
export const dynamicParams = false;

// this reserverd function is a magic for caching
export async function generateStaticParams() {
  // return range of numbers from 1 to 929
  return Array.from({ length: 929 }, (_, i) => i + 1);
}
const searchParamsCache = createSearchParamsCache({
  // List your search param keys and associated parsers here:
  book: parseAsString,
});

// TODO: figure out if need to use generateMetadata
export default async function Perek({
  params: { number },
  searchParams,
}: {
  params: { number: number };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const perekId = number;
  const perekObj = getPerekByPerekId(perekId);
  const { book: bookSearchParam } = searchParamsCache.parse(searchParams);
  const isBook = bookSearchParam != null;
  return (
    <>
      <Suspense>
        <SeferComposite perekObj={perekObj} toggled={isBook} />
      </Suspense>
      <div className="absolute z-[6] top-[72px] w-full h-[calc(100vh-72px)]">
        <Breadcrumb perekObj={perekObj} />

        <article className={styles.perekText}>
          {perekObj.pesukim.map((pasuk, pasukIdx) => {
            const pasukKey = pasukIdx + 1;
            const pasukNumElement = (
              <a className={styles.pasukNum}>{toLetters(pasukIdx + 1)}</a>
            );
            const pasukElement = pasuk.segments.map((segment, segmentIdx) => {
              const segmentKey = pasukIdx + 1 + "-" + (segmentIdx + 1);
              // TODO: merge qris sequnce like in 929/406
              return (
                <React.Fragment key={segmentKey}>
                  <a className={segment.type == "qri" ? styles.qri : ""}>
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
                    segment.value.at(segment.value.length - 1) ===
                      "־") ? null : (
                    <span> </span>
                  )}
                </React.Fragment>
              );
            });
            return (
              <React.Fragment key={pasukKey}>
                {pasukNumElement}
                <span> </span>
                {pasukElement}
                <span> </span>
              </React.Fragment>
            );
          })}
        </article>
      </div>
    </>
  );
}
