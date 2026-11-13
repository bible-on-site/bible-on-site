import BulletList from "@tiptap/extension-bullet-list";
import Image from "@tiptap/extension-image";
import Italic from "@tiptap/extension-italic";
import ListItem from "@tiptap/extension-list-item";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { adminEditorShortcutsExtension } from "./adminEditorShortcuts";
import {
	AdminFootnoteDocument,
	adminFootnoteExtensions,
} from "./adminFootnoteExtensions";
import { AdminLink } from "./adminLinkExtension";
import { AdminOrderedList } from "./adminOrderedListExtension";

const ItalicNoShortcut = Italic.extend({
	addKeyboardShortcuts() {
		return {};
	},
});

/**
 * The exact extension set {@link WysiwygEditor} mounts. Shared so tests can
 * exercise the real schema and plugins instead of a hand-built approximation.
 */
export function createAdminEditorExtensions(placeholder?: string) {
	return [
		StarterKit.configure({
			heading: { levels: [1, 2, 3, 4, 5, 6] },
			italic: false,
			orderedList: false,
			bulletList: false,
			listItem: false,
			document: false,
			/* StarterKit v3 bundles Link; AdminLink replaces it. */
			link: false,
		}),
		AdminFootnoteDocument,
		ListItem,
		BulletList,
		AdminOrderedList,
		ItalicNoShortcut,
		Image,
		AdminLink.configure({ openOnClick: false }),
		Placeholder.configure({ placeholder }),
		adminEditorShortcutsExtension,
		...adminFootnoteExtensions,
	];
}
