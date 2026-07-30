import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FontiCatastali — Ricerca normativa catastale",
  description:
    "Motore di ricerca full-text sulla normativa catastale italiana: circolari, risoluzioni, provvedimenti, sentenze e altro.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Script anti-FOUC: applica la classe `dark` prima del paint, leggendo
  // localStorage o la preferenza di sistema. Inline e sincrono di proposito.
  const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

  return (
    <html lang="it" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
