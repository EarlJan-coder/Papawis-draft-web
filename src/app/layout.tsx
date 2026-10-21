import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { getLeagueName } from "@/lib/config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: getLeagueName(),
    template: `%s | ${getLeagueName()}`,
  },
  description: "Basketball league registration and team draft platform.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border bg-white py-6">
          <p className="mx-auto max-w-6xl px-4 text-sm text-muted-foreground sm:px-6">
            {getLeagueName()} — basketball league registration &amp; draft
            platform.
          </p>
        </footer>
      </body>
    </html>
  );
}
