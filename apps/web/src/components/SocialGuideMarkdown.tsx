"use client";

import { Children, isValidElement, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

/** Plain text of a React subtree (used to copy the exact contents of a fenced code block). */
function plainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return plainText(node.props.children);
  return Children.toArray(node).map(plainText).join("");
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const code = plainText(children).replace(/\n$/, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  }

  return (
    <div className="group relative my-4 rounded-[8px] border border-command-border bg-[#060a13]">
      <div className="flex items-center justify-end border-b border-command-border px-2 py-1.5">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md border border-command-border px-2.5 py-1 text-xs font-semibold text-command-soft transition hover:border-command-accent/50 hover:text-command-ink"
          aria-live="polite"
        >
          {copied === "copied" ? (
            <>
              <Check className="h-3.5 w-3.5 text-command-accent" />
              Copied
            </>
          ) : copied === "failed" ? (
            "Copy failed"
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-6 text-command-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  h1: ({ children }) => <h1 className="mt-8 text-2xl font-black tracking-[-0.01em] text-command-ink first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-8 text-xl font-bold text-command-ink first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 text-base font-bold text-command-ink">{children}</h3>,
  p: ({ children }) => <p className="my-3 text-sm leading-7 text-command-soft">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5 text-sm leading-7 text-command-soft marker:text-command-muted">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5 text-sm leading-7 text-command-soft marker:text-command-muted">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-semibold text-command-accent underline decoration-command-accent/40 underline-offset-4 hover:decoration-command-accent"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-command-ink">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.85em] text-command-ink">{children}</code>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-command-accent/50 pl-4 text-sm italic text-command-muted">{children}</blockquote>
  ),
  hr: () => <hr className="my-8 border-command-border" />,
  table: ({ children }) => (
    <div className="my-4 w-full overflow-x-auto rounded-[8px] border border-command-border">
      <table className="w-full min-w-[480px] border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.08em] text-command-muted">{children}</thead>,
  th: ({ children }) => <th className="border border-command-border px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-command-border px-3 py-2 align-top text-command-soft">{children}</td>,
};

/** Renders the setup guide. Markdown only: raw HTML in the source is not rendered. */
export function SocialGuideMarkdown({ markdown }: { markdown: string }) {
  return (
    <article className="max-w-3xl">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </article>
  );
}
