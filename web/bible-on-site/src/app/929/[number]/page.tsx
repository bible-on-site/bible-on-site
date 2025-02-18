// import Image from "next/image";
import styles from "./page.module.css";
import "./overiide-globals.css";
import { toLetters } from "gematry";
import { createSearchParamsCache, parseAsString } from "nuqs/server";
import { Suspense } from "react";
import React from "react";
import { getPerekByPerekId } from "../../../data/perek-dto";
import Breadcrumb from "./components/Breadcrumb";
import { Ptuah } from "./components/Ptuha";
import SeferComposite from "./components/SeferComposite";
import { Stuma } from "./components/Stuma";
// perakim are a closed list.
export const dynamicParams = false;

// this reserverd function is a magic for caching
export function generateStaticParams() {
  // Return an array of objects with the key "number" as a string
  return Array.from({ length: 929 }, (_, i) => ({ number: String(i + 1) }));
}
const searchParamsCache = createSearchParamsCache({
  // List your search param keys and associated parsers here:
  book: parseAsString,
});

// TODO: figure out if need to use generateMetadata
export default async function Perek({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { number } = await params;
  const resolvedSearchParams = await searchParams;
  const perekId = Number.parseInt(number, 10); // convert string to number
  const perekObj = getPerekByPerekId(perekId);
  const { book: bookSearchParam } = searchParamsCache.parse(resolvedSearchParams);
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
            const pasukNumElement = <span className={styles.pasukNum}>{toLetters(pasukIdx + 1)}</span>;
            const pasukElement = pasuk.segments.map((segment, segmentIdx) => {
              const segmentKey = `${pasukIdx + 1}-${segmentIdx + 1}`;
              // TODO: merge qris sequnce like in 929/406
              return (
                <React.Fragment key={segmentKey}>
                  <span className={segment.type === "qri" ? styles.qri : ""}>
                    {segment.type === "ktiv" ? (
                      segment.value
                    ) : segment.type === "qri" ? (
                      <>
                        {/* biome-ignore lint/a11y/noLabelWithoutControl: It'll take some time to validate this fix altogether with css rules */}
                        (<label />
                        {segment.value})
                      </>
                    ) : segment.type === "ptuha" ? (
                      Ptuah()
                    ) : (
                      Stuma()
                    )}
                  </span>
                  {segmentIdx === pasuk.segments.length - 1 ||
                  ((segment.type === "ktiv" || segment.type === "qri") &&
                    segment.value.at(segment.value.length - 1) === "־") ? null : (
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
