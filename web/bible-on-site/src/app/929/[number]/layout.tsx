import type React from "react";
import Image from "next/image";
import Link from "next/link";
import "./layout.css";

export default function PerekLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="perek-layout">
      <nav className="top-nav perek-nav">
        <Link href="/">
          <Image
            src="/images/logos/logo-white-letters-69.webp"
            alt='תנ"ך על הפרק'
            width={72}
            height={72}
          />
        </Link>
      </nav>
      {children}
    </div>
  );
}
