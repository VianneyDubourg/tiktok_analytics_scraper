import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TikTok Stats Checker",
  description: "Consultez gratuitement les statistiques publiques de n'importe quel compte TikTok : abonnés, likes, vues par vidéo.",
  openGraph: {
    title: "TikTok Stats Checker",
    description: "Consultez gratuitement les statistiques publiques de n'importe quel compte TikTok.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "TikTok Stats Checker",
    description: "Consultez gratuitement les statistiques publiques de n'importe quel compte TikTok.",
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
