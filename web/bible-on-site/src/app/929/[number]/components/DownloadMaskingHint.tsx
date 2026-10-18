"use client";

import { type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { openReaderSettings } from "@/lib/recitation-settings";
import styles from "./sefer.module.css";

const MENU_SELECTOR = ".flipbook-toolbar-download-menu";

/**
 * Adds the הסתר שם השם hint to the flip-book download menu. The menu belongs
 * to html-flip-book-react, so the hint is portaled into it while it is open.
 */
export function DownloadMaskingHint({
	toolbarRef,
}: {
	toolbarRef: RefObject<HTMLElement | null>;
}) {
	const [menu, setMenu] = useState<HTMLElement | null>(null);
	useEffect(() => {
		const root = toolbarRef.current;
		/* istanbul ignore next: the ref is attached before effects run */
		if (!root) return;
		const sync = () => setMenu(root.querySelector<HTMLElement>(MENU_SELECTOR));
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [toolbarRef]);
	if (!menu) return null;
	return createPortal(
		<p className={styles.downloadHint}>
			מומלץ לבחון{" "}
			<button
				type="button"
				className={styles.downloadHintLink}
				onClick={(event) => openReaderSettings("display", event.currentTarget)}
			>
				הסתרת שם השם
			</button>
		</p>,
		menu,
	);
}
