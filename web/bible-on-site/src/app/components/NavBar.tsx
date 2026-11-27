"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { appPlatforms } from "./appPlatforms";
import styles from "./navbar.module.css";

type NavSubItem = {
	href: string;
	label: string;
	icon: string;
	title?: string;
	/** Visible secondary line inside the same link (#3731). */
	subtitle?: string;
};

type NavItem = NavSubItem & { sub?: NavSubItem[] };

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
	{
		title: "לימוד על הפרק",
		items: [
			{
				href: "/929",
				label: "על הפרק",
				icon: "/icons/open-book.svg",
				subtitle: "הלימוד בחלוקה המוכרת",
			},
		],
	},
	{
		title: "חלוקות נוספות",
		items: [
			{
				href: "/מסורה",
				label: "מסורה על הפרק",
				icon: "/icons/separator-horizontal.svg",
				subtitle: "חלוקת המסורה היהודית הקדומה",
			},
			{
				href: "/פרשה",
				label: "פרשה על הפרק",
				icon: "/icons/scroll.svg",
				subtitle: "לימוד לפי סדר הפרשות",
			},
			{
				href: "/מועדים",
				label: "מועדים על הפרק",
				icon: "/icons/party-popper.svg",
				subtitle: "לימוד במעגל השנה",
			},
			{
				href: "/929/authors",
				label: "הרבנים",
				icon: "/icons/rabbi.svg",
				subtitle: "איתור מאמרים לפי המחברים",
			},
		],
	},
	{
		title: "אפשרויות לימוד נוספות",
		items: [
			{
				href: "/dailyBulletin",
				label: "עלון יומי",
				icon: "/icons/daily-bulletin.svg",
				subtitle: "הפרק היומי והמאמרים ישירות אליכם",
			},
			{
				href: "/app",
				label: "יישומון",
				icon: "/icons/smartphone.svg",
				sub: appPlatforms.map((platform) => ({
					href: platform.href ?? "",
					label: platform.name,
					icon: platform.icon,
					title: platform.description,
				})),
			},
		],
	},
	{
		title: "כלי לימוד",
		items: [
			{
				href: "/pedia",
				label: "תנכפדיה",
				icon: "/icons/library.svg",
				subtitle: 'אנציקלופדיה תנ"כית',
			},
			{
				href: "/לוח",
				label: "לוח לימוד יומי",
				icon: "/icons/calendar-today.svg",
				subtitle: "לוח עזר פרקים לפי תאריך",
			},
		],
	},
	{
		title: "שונות",
		items: [
			{
				href: "/tos",
				label: "תנאי שימוש",
				icon: "/icons/handshake.svg",
				subtitle: "והצהרות פרטיות ונגישות",
			},
			{ href: "/donation", label: "תרומות", icon: "/icons/donation.svg" },
			{ href: "/contact", label: "צור קשר", icon: "/icons/contact.svg" },
		],
	},
];

// next.config rewrites serve the Hebrew canonical URLs from ASCII route
// dirs, so the prerendered pathname (/masora) differs from the browser one
// (/מסורה). Normalizing both to the menu key keeps the active item identical
// between server HTML and hydration.
const INTERNAL_TO_MENU: [RegExp, string][] = [
	[/^\/calendar/, "/לוח"],
	[/^\/masora/, "/מסורה"],
	[/^\/moadim/, "/מועדים"],
	[/^\/parasha/, "/פרשה"],
	[/^\/929\/rabbis/, "/929/authors"],
];

const normalizePathname = (pathname: string): string => {
	let path = pathname;
	try {
		path = decodeURIComponent(pathname);
	} catch {
		console.warn(`NavBar: could not decode pathname "${pathname}"`);
	}
	for (const [pattern, canonical] of INTERNAL_TO_MENU) {
		path = path.replace(pattern, canonical);
	}
	return path;
};

const activeMenuHref = (pathname: string): string | null => {
	const normalized = normalizePathname(pathname);
	let best: string | null = null;
	for (const group of NAV_GROUPS) {
		for (const item of group.items) {
			for (const href of [item.href, ...(item.sub ?? []).map((s) => s.href)]) {
				if (
					(normalized === href || normalized.startsWith(`${href}/`)) &&
					(best === null || href.length > best.length)
				) {
					best = href;
				}
			}
		}
	}
	return best;
};

export const NavBar = ({ version }: { version: string }) => {
	const [open, setOpen] = useState(false);
	const pathname = usePathname();
	const menuPathname = normalizePathname(pathname);
	const [lastPathname, setLastPathname] = useState(menuPathname);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const current = activeMenuHref(pathname);

	// Compare the same rewritten/canonical menu keys used for aria-current;
	// otherwise hydration of an aliased route can look like navigation and
	// immediately close the drawer the user just opened.
	if (menuPathname !== lastPathname) {
		setLastPathname(menuPathname);
		setOpen(false);
	}

	const closeAndFocusTrigger = () => {
		setOpen(false);
		triggerRef.current?.focus();
	};

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
				triggerRef.current?.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open]);

	// Sub items are always external store links (appPlatforms).
	const subLink = (sub: NavSubItem) => (
		<a
			href={sub.href || undefined} // nosemgrep -- repo-owned appPlatforms store links, not user input
			target="_blank"
			rel="noopener noreferrer"
			title={sub.title}
			className={`${styles.itemLink} ${styles.storeLink}`}
		>
			<span className={styles.itemIcon}>
				<Image src={sub.icon} alt="" unoptimized width={16} height={16} />
			</span>
			<span className={styles.itemText}>
				<span className={styles.storeName} dir="ltr">
					{sub.label}
				</span>
			</span>
		</a>
	);

	return (
		<div className={open ? styles.open : undefined}>
			<button
				ref={triggerRef}
				type="button"
				className={styles.menuBtn}
				aria-label="תפריט ראשי"
				aria-expanded={open}
				aria-controls="main-menu"
				onClick={() => setOpen(!open)}
			>
				<span className={styles.menuIcon} />
			</button>

			<div
				className={styles.overlay}
				aria-hidden="true"
				onClick={closeAndFocusTrigger}
			/>

			{/* Same-page links don't change the pathname, so close on any link click too. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: delegated link clicks; Enter on a link fires click too */}
			<nav
				id="main-menu"
				aria-label="תפריט ראשי"
				className={styles.menuBox}
				inert={!open}
				onClick={(event) => {
					if ((event.target as Element).closest("a")) setOpen(false);
				}}
			>
				<header className={styles.sidebarTopBar}>
					<Link href="/" className={styles.drawerHomeLink}>
						<Image
							src="/images/logos/logo192.webp"
							alt="עמוד ראשי"
							unoptimized
							width={36}
							height={36}
						/>
					</Link>
					<button
						type="button"
						className={styles.drawerCloseButton}
						onClick={closeAndFocusTrigger}
					>
						<span className={styles.drawerCloseIcon} aria-hidden="true" />
						<span>סגור</span>
					</button>
				</header>
				<ul className={styles.menuList}>
					{NAV_GROUPS.map((group) => (
						<li key={group.title} className={styles.menuGroup}>
							<h2 className={styles.groupTitle}>{group.title}</h2>
							<ul className={styles.groupItems}>
								{group.items.map((item) => (
									<li key={item.href} className={styles.menuItem}>
										<Link
											href={item.href}
											aria-current={
												item.href === current ? "page" : undefined
											}
											className={styles.itemLink}
										>
											<span className={styles.itemIcon}>
												<Image
													src={item.icon}
													alt=""
													unoptimized
													width={16}
													height={16}
												/>
											</span>
											<span className={styles.itemText}>
												<span className={styles.itemTitle}>{item.label}</span>{" "}
												{item.subtitle && (
													<small className={styles.itemSubtitle}>
														{item.subtitle}
													</small>
												)}
											</span>
										</Link>
										{item.sub && (
											<ul className={styles.storeList}>
												{item.sub.map((sub) => (
													<li key={sub.label} className={styles.storeItem}>
														{subLink(sub)}
													</li>
												))}
											</ul>
										)}
									</li>
								))}
							</ul>
						</li>
					))}
					<li
						className={styles.versionItem}
						style={
							{
								"--version-content": `"- ${version} -"`,
							} as React.CSSProperties
						}
					/>
				</ul>
			</nav>
		</div>
	);
};

export default NavBar;
