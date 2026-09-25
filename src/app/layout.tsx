import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Utah City — Operational Intelligence",
  description:
    "Capture operational reality across the resident journey and turn it into structured intelligence for Utah City leadership.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#070b12",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased bg-[#070b12] text-[#f0f6ff]`}>
      <body className="h-full h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none bg-[#070b12]" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
