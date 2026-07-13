import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Anton, Instrument_Sans } from "next/font/google";
import "./globals.css";

const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-anton",
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument",
});

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#a03123"/><text x="16" y="23" font-family="Arial Black,sans-serif" font-size="19" font-weight="900" fill="#f0e9dc" text-anchor="middle">G</text></svg>',
  );

export const metadata: Metadata = {
  title: "Pitch Gauntlet - pitch a panel of AI VCs that interrupt you",
  description:
    "Pitch your startup for up to 90 seconds while three AI VCs interrupt you mid-sentence. Survive as long as you can.",
  metadataBase: new URL("https://gauntlet.speko.dev"),
  openGraph: {
    title: "Pitch Gauntlet",
    description:
      "Pitch your startup. Three AI VCs will not be polite. Survive as long as you can.",
    siteName: "Pitch Gauntlet",
  },
  icons: { icon: FAVICON },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${anton.variable} ${instrument.variable}`}>
      <body className="font-body antialiased">
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>
          <footer className="border-t border-rulec">
            <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-8 text-sm text-parchment-dim sm:flex-row sm:items-center sm:justify-between">
              <p>
                Built on{" "}
                <a
                  className="font-semibold text-spotlight underline-offset-4 hover:underline"
                  href="https://speko.ai?utm_source=pitch-gauntlet&utm_medium=viral&utm_campaign=viral-3x"
                >
                  Speko
                </a>{" "}
                - the voices and the barge-in are the product.
              </p>
              <nav className="flex gap-5">
                <Link className="hover:text-parchment" href="/board">
                  The board
                </Link>
                <Link className="hover:text-parchment" href="/how">
                  How it works
                </Link>
              </nav>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
