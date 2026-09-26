"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { BarChart3, Bot, GitBranch, ListChecks, Map, Search, Settings, Smartphone } from "lucide-react";

const items = [
  { href: "/command", label: "Open Command", helper: "Executive operating console", icon: BarChart3 },
  { href: "/analyst", label: "Ask AI Analyst", helper: "Interrogate the corpus", icon: Bot },
  { href: "/journey", label: "Open Journey", helper: "Resident lifecycle spine", icon: GitBranch },
  { href: "/signals", label: "Open Signals", helper: "Objections, amenities, themes", icon: Map },
  { href: "/evidence", label: "Search Evidence", helper: "Transcript-grounded corpus", icon: Search },
  { href: "/operations", label: "Open Operations", helper: "Capture quality and adoption", icon: ListChecks },
  { href: "/settings", label: "Open Settings", helper: "Admin and demo controls", icon: Settings },
  { href: "/", label: "Start Capture", helper: "Mobile field capture", icon: Smartphone },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (!event.metaKey && !event.ctrlKey && event.key === "/" && document.activeElement === document.body) {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="command-palette-trigger">
          <Search className="h-3.5 w-3.5" />
          <span>Command</span>
          <kbd>⌘K</kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="command-dialog-overlay" />
        <Dialog.Content className="command-dialog">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command className="command-menu">
            <div className="command-input-wrap">
              <Search className="h-4 w-4 text-command-muted" />
              <Command.Input placeholder="Search routes, evidence, actions..." />
            </div>
            <Command.List className="command-list">
              <Command.Empty className="px-4 py-6 text-sm text-command-muted">No command found.</Command.Empty>
              <Command.Group heading="Navigation">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item key={item.href} value={`${item.label} ${item.helper}`} asChild>
                      <Link href={item.href} onClick={() => setOpen(false)}>
                        <Icon className="h-4 w-4" />
                        <span>
                          <span className="block text-sm font-semibold">{item.label}</span>
                          <span className="block text-xs text-command-muted">{item.helper}</span>
                        </span>
                      </Link>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
