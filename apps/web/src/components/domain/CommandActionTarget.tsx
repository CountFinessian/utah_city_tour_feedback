"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Anchors a Command action card so Evidence "Open on Command" can land on
 * the matching item (not just the bottom of the page).
 */
export function CommandActionTarget({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (hash !== id) return;

    setActive(true);
    const timer = window.setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [id]);

  return (
    <div
      id={id}
      ref={ref}
      className={`scroll-mt-24 rounded-xl transition-[box-shadow] ${
        active ? "ring-2 ring-[#43d9c7]/55" : ""
      }`}
    >
      {children}
    </div>
  );
}
