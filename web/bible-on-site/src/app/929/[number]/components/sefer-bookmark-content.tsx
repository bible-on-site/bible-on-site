import type { Bookmark } from "html-flip-book-react";
import type { CSSProperties, ReactElement } from "react";
import type { SeferBookmarkData } from "./sefer-bookmarks";

/** Static tab content can keep the same React children across native turns. */
export function createSeferBookmarkContent(color: string) {
	const compactNodes = new Map<string, ReactElement>();
	const expandedNodes = new Map<
		string,
		Map<string | undefined, ReactElement>
	>();
	return {
		renderBookmark(bookmark: Bookmark) {
			const data = bookmark.data as SeferBookmarkData;
			let node = compactNodes.get(data.compact);
			if (!node) {
				node = <span className="sefer-bookmark-label">{data.compact}</span>;
				compactNodes.set(data.compact, node);
			}
			return node;
		},
		renderExpandedBookmark(bookmark: Bookmark) {
			const data = bookmark.data as SeferBookmarkData;
			let titles = expandedNodes.get(data.compact);
			if (!titles) {
				titles = new Map();
				expandedNodes.set(data.compact, titles);
			}
			let node = titles.get(data.title);
			if (!node) {
				node = (
					<span
						className="sefer-bookmark-expanded"
						style={{ "--cover-color": color } as CSSProperties}
					>
						<span className="sefer-bookmark-expanded-perek">
							פרק {data.compact}
						</span>
						{data.title && (
							<span className="sefer-bookmark-expanded-title">
								{data.title}
							</span>
						)}
					</span>
				);
				titles.set(data.title, node);
			}
			return node;
		},
	};
}
