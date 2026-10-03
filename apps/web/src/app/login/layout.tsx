import type { Viewport } from "next";

/** Allow normal pinch-zoom on auth; 16px fields already prevent iOS focus-zoom. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070b12",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-stage fixed inset-0 z-0 overflow-y-auto overscroll-y-contain bg-[#070b12] text-[#e8eef7]">
      {children}
    </div>
  );
}
