import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-sans",
});

export const metadata: Metadata = {
  title: "Utah City — Operational Intelligence",
  description:
    "Capture operational reality across the resident journey and turn it into structured intelligence for Utah City leadership.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Utah City",
  },
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
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} h-full antialiased bg-[#070b12] text-[#f0f6ff]`}>
      <body className="min-h-full bg-[#070b12] text-[#f0f6ff]" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
