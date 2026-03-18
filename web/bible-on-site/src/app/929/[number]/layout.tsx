import "@/lib/download/register-tanach";
import type React from "react";
import "./layout.css";

// Placed in layout (not page) so child routes ([slug]/page.tsx) receive
// the parent params in their own generateStaticParams.
/* istanbul ignore next: only runs during next build */
export function generateStaticParams() {
	return Array.from({ length: 929 }, (_, i) => ({ number: String(i + 1) }));
}

export default function PerekLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="perek-layout">{children}</div>;
}
