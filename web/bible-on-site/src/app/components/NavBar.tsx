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
	external?: boolean;
	title?: string;
};

type NavItem = NavSubItem & { sub?: NavSubItem[] };

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
	{
		title: "לימוד",
		items: [
			{ href: "/929", label: "על הפרק", icon: "/icons/open-book.svg" },
			{
				href: "/מסורה",
				label: "מסורה על הפרק",
				icon: "/icons/separator-horizontal.svg",
			},
			{ href: "/פרשה", label: "פרשה על הפרק", icon: "/icons/scroll.svg" },
			{
				href: "/מועדים",
				label: "מועדים על הפרק",
				icon: "/icons/party-popper.svg",
			},
			{ href: "/לוח", label: "לוח לימוד יומי", icon: "/icons/calendar-today.svg" },
		],
	},
	{
		title: "תוכן",
		items: [
			{ href: "/929/authors", label: "הרבנים", icon: "/icons/rabbi.svg" },
			{ href: "/pedia", label: "תנכפדיה", icon: "/icons/library.svg" },
			{
				href: "/dailyBulletin",
				label: "עלון יומי",
				icon: "/icons/daily-bulletin.svg",
				sub: [
					{
						href: "/whatsappGroup",
						label: "קבוצת ווטסאפ",
						icon: "/icons/whatsapp.svg",
					},
				],
			},
		],
	},
	{
		title: "שירות",
		items: [
			{ href: "/tos", label: "תנאי שימוש", icon: "/icons/handshake.svg" },
			{
				href: "/app",
				label: "יישומון",
				icon: "/icons/smartphone.svg",
				sub: appPlatforms.map((platform) => ({
					href: platform.href ?? "",
					label: platform.name,
					icon: platform.icon,
					external: true,
					title: platform.description,
				})),
			},
			{ href: "/contact", label: "צור קשר", icon: "/icons/contact.svg" },
			{ href: "/donation", label: "תרומות", icon: "/icons/donation.svg" },
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
	const [lastPathname, setLastPathname] = useState(pathname);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const current = activeMenuHref(pathname);

	if (pathname !== lastPathname) {
		setLastPathname(pathname);
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

	const subLink = (sub: NavSubItem) =>
		sub.external ? (
			// nosemgrep: typescript.react.security.audit.react-href-var -- hrefs are
			// repo-owned app-store constants from appPlatforms, never user input
			<a
				href={sub.href || undefined}
				target="_blank"
				rel="noopener noreferrer"
			>
				<span>{sub.label}</span>
			</a>
		) : (
			// nosemgrep: typescript.react.security.audit.react-href-var -- href is a
			// literal menu route constant declared in NAV_GROUPS above
			<Link
				href={sub.href}
				aria-current={sub.href === current ? "page" : undefined}
			>
				<span>{sub.label}</span>
			</Link>
		);

	return (
		<div className={`${styles.hamburgerMenu} ${open ? styles.open : ""}`}>
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
					<Link href="/">
						<Image
							src="/images/logos/logo192.webp"
							alt="עמוד ראשי"
							unoptimized
							width={72}
							height={72}
						/>
					</Link>
				</header>
				<ul className={styles.menuList}>
					{NAV_GROUPS.map((group) => (
						<li key={group.title} className={styles.menuGroup}>
							<h2 className={styles.groupTitle}>{group.title}</h2>
							<ul className={styles.groupItems}>
								{group.items.map((item) => (
									<li key={item.href} className={styles.menuItem}>
										<Image
											src={item.icon}
											alt=""
											unoptimized
											width={16}
											height={16}
										/>
										<Link
											href={item.href}
											aria-current={
												item.href === current ? "page" : undefined
											}
										>
											<span>{item.label}</span>
										</Link>
										{item.sub && (
											<ul>
												{item.sub.map((sub) => (
													<li
														key={sub.label}
														className={styles.menuItem}
														title={sub.title}
													>
														<Image
															src={sub.icon}
															alt=""
															unoptimized
															width={16}
															height={16}
														/>
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
