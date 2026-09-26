export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-stage fixed inset-0 z-0 overflow-y-auto overscroll-none bg-[#070b12] text-[#e8eef7]">
      {children}
    </div>
  );
}