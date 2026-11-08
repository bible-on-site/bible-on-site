import { getBookshelfDedicationLines } from "@/lib/dedications/loaders";
import { BookshelfPageClient } from "./BookshelfPageClient";

/**
 * /bookshelf — the sefarim picker. The dedication read is tag-cached
 * (`dedications:bookshelf`), so a dedication change expires this page
 * through the normal dependency resolution (#2731).
 */
export default async function BookshelfPage() {
	const dedications = await getBookshelfDedicationLines();
	return <BookshelfPageClient dedications={dedications} />;
}
