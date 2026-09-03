import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Fetched once at build time and served from our own output, so the page
// never asks Google for anything at runtime. The variable lands on <html> and
// globals.css reads it as --gf-font-sans.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "GoodFolder | See what changed in your folder, and go back",
  description:
    "GoodFolder gives a folder on your computer a history you can read. See what an agent or a person changed, who did it, and return to any earlier version. Your files stay where they are and keep their formats.",
  icons: {
    icon: [
      { url: "/brand/goodfolder-favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/brand/goodfolder-apple-touch.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`scroll-smooth ${inter.variable}`}>
      <body className="bg-white text-black antialiased">{children}</body>
    </html>
  );
}
