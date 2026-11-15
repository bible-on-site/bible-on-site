import styles from "./SectionDivider.module.css";

/**
 * Shaped decorative edge between two adjacent landing feature sections
 * (#3267). Paints the NEIGHBORING section's surface color through a shared
 * NON-SYMMETRIC wave mask — the same artistic multi-lobe transition
 * language as the sefarim/numbers/contact dividers — so the boundary is a
 * deliberate color interplay, not a straight seam or a symmetric dome.
 *
 * Landing-section contract (docs/practices/implementation.md): each
 * independent top-level landing feature owns a distinct visual band and
 * renders this divider at the edge it shares with the next feature. The
 * owning section sets `--divider-paint` to the next band's surface color —
 * including its dark-scheme value — so the paint stays in CSS and follows
 * the active theme without tinted asset variants.
 *
 * Decorative only: non-interactive and hidden from assistive technology.
 */
export function SectionDivider() {
	return <div aria-hidden="true" className={styles.divider} />;
}
