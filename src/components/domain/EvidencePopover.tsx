"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { ExternalLink, Quote } from "lucide-react";

export type EvidenceItem = {
  id: string;
  label: string;
  excerpt: string;
  meta?: string;
};

export function EvidencePopover({
  count,
  items,
  label = "evidence",
}: {
  count: number;
  items: EvidenceItem[];
  label?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="evidence-trigger">
          <Quote className="h-3.5 w-3.5" />
          {count} {label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={8} className="evidence-popover">
          <div className="flex items-center justify-between gap-3 border-b border-command-border px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-command-muted">Evidence</p>
            <span className="font-mono text-xs text-command-muted">{items.length} sources</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2">
            {items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-command-muted">No transcript evidence available.</p>
            ) : (
              items.map((item) => (
                <article key={item.id} className="evidence-popover-item">
                  {item.meta && (
                    <span className="mb-2 block font-mono text-[11px] font-semibold text-command-accent">{item.meta}</span>
                  )}
                  <blockquote className="border-l-2 border-command-accent/40 pl-3 text-sm italic leading-relaxed text-command-ink">
                    {item.excerpt}
                  </blockquote>
                  <Link
                    href={`/evidence?highlight=${item.id}`}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-command-accent hover:underline"
                  >
                    View full transcript <ExternalLink className="h-3 w-3" />
                  </Link>
                </article>
              ))
            )}
          </div>
          <Popover.Arrow className="fill-command-panel" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
