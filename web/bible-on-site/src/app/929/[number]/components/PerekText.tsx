import { toLetters } from "gematry";
import type { PerekObj } from "@/data/perek-dto";
import { buildEntityRefLookup } from "@/lib/tanahpedia/entity-ref-lookup";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import styles from "../page.module.css";
import { Ptuah } from "./Ptuha";
import { renderPasukWithEntityRefs } from "./pasuk-renderer";
import { Stuma } from "./Stuma";
import { TanahpediaLink } from "./TanahpediaLink";

export function PerekText({
	perekObj,
	entityRefs,
}: {
	perekObj: PerekObj;
	entityRefs: PerekEntityReference[];
}) {
	const entityRefLookup = buildEntityRefLookup(entityRefs);
	return (
		<article className={styles.perekText}>
			{perekObj.pesukim.map((pasuk, pasukIdx) => {
				const pasukNumber = pasukIdx + 1;
				return (
					<span key={pasukNumber} id={`pasuk-${pasukNumber}`}>
						<span className={styles.pasukNum}>{toLetters(pasukNumber)}</span>{" "}
						{renderPasukWithEntityRefs(
							pasuk.segments,
							pasukIdx,
							entityRefLookup,
							Ptuah,
							Stuma,
							styles.qri,
							(entryUniqueName, children, key) => (
								<TanahpediaLink
									key={key}
									entryUniqueName={entryUniqueName}
									className={styles.tanahpediaLink}
								>
									{children}
								</TanahpediaLink>
							),
						)}{" "}
					</span>
				);
			})}
		</article>
	);
}
