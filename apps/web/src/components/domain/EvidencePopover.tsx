"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { ExternalLink, Quote } from "lucide-react";
import { CopyTextButton } from "@/components/CopyTextButton";

export type EvidenceItem = {
  id: string;
  label: string;
  excerpt: string;
  meta?: string;
  href?: string;
  /** Short line tying this item to the KPI formula or filter. */
  why?: string;
  kind?: "quote" | "driver";
};

export function EvidencePopover({
  count,
  items,
  label = "evidence",
}: {
  count?: number;
  items: EvidenceItem[];
  label?: string;
}) {
  const shown = count ?? items.length;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="evidence-trigger">
          <Quote className="h-3.5 w-3.5" />
          {shown} {label}
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
                  {item.why && (
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-command-muted">
                      {item.why}
                    </span>
                  )}
                  {item.meta && (
                    <span className="mb-2 block font-mono text-[11px] font-semibold text-command-accent">{item.meta}</span>
                  )}
                  {item.kind === "driver" ? (
                    <p className="text-sm leading-relaxed text-command-ink">
                      <span className="font-semibold">{item.label}</span>
                      {item.excerpt ? `: ${item.excerpt}` : ""}
                    </p>
                  ) : (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-command-muted">
                          Excerpt
                        </span>
                        <CopyTextButton text={item.excerpt} label="Copy transcript" />
                      </div>
                      <textarea
                        readOnly
                        value={item.excerpt}
                        rows={3}
                        className="evidence-transcript-field"
                        aria-label="Evidence excerpt"
                      />
                    </div>
                  )}
                  {item.kind !== "driver" && (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Link
                        href={item.href || `/evidence?highlight=${item.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-command-accent hover:underline"
                      >
                        View full transcript <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  )}
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
