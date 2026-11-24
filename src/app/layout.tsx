import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RTS Faculty Portal", template: "%s · RTS Faculty Portal" },
  description: "Research, Teaching & Service annual submissions and review",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
