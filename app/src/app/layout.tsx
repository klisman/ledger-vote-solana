import type { ReactNode } from "react";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Syne } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Ledger Vote",
  description:
    "On-chain poll book. Vote weight is floor of the square root of your token balance.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${plex.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
