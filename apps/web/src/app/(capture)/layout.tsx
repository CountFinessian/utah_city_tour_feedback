export default function CaptureLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="capture-app-root min-h-full bg-[#070b12]">
      {children}
    </div>
  );
}
