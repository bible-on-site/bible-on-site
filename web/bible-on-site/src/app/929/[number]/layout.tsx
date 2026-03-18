import "@/lib/download/register-tanach";
import type React from "react";
import "./layout.css";

export default function PerekLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="perek-layout">{children}</div>;
}
