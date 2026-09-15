// bb-plugin-plan-pane — frontend: a "Plan" button in the thread header, a
// command-palette row, and a keyboard shortcut. All three open the thread's
// plan.md in THIS window's panel only (no broadcast to other windows).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { PlanSource, rpcContract } from "./server";

/** Window event used by the palette row and the shortcut to reach the mounted button. */
const OPEN_EVENT = "plan-pane:open";

type OpenMode = "panel" | "right" | "down";

function threadIdFromLocation(): string | null {
  const match = /\/threads\/(thr_[a-z0-9]+)/i.exec(window.location.pathname);
  return match ? match[1] : null;
}

function requestOpen(threadId: string | null, mode: OpenMode = "panel") {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { threadId, mode } }));
}

interface Chord {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

function parseChord(value: string): Chord | null {
  const parts = value.trim().toLowerCase().split("+").filter(Boolean);
  if (parts.length === 0) return null;
  const chord: Chord = { mod: false, ctrl: false, alt: false, shift: false, meta: false, key: "" };
  for (const part of parts) {
    if (part === "mod" || part === "cmd") chord.mod = true;
    else if (part === "ctrl" || part === "control") chord.ctrl = true;
    else if (part === "alt" || part === "option") chord.alt = true;
    else if (part === "shift") chord.shift = true;
    else if (part === "meta") chord.meta = true;
    else chord.key = part;
  }
  return chord.key.length === 0 ? null : chord;
}

function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  const isMac = /mac|iphone|ipad/i.test(navigator.platform);
  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  if (chord.mod && !modPressed) return false;
  if (chord.ctrl && !event.ctrlKey) return false;
  if (chord.meta && !event.metaKey) return false;
  if (chord.alt !== event.altKey) return false;
  if (chord.shift !== event.shiftKey) return false;
  if (!chord.mod && !chord.ctrl && !chord.meta && (event.metaKey || event.ctrlKey)) return false;
  return event.key.toLowerCase() === chord.key || event.code.toLowerCase() === `key${chord.key}`;
}

function formatChord(value: string): string {
  const chord = parseChord(value);
  if (!chord) return "";
  const isMac = /mac|iphone|ipad/i.test(navigator.platform);
  const parts: string[] = [];
  if (chord.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
  if (chord.alt) parts.push(isMac ? "⌥" : "Alt");
  if (chord.shift) parts.push(isMac ? "⇧" : "Shift");
  if (chord.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (chord.meta) parts.push(isMac ? "⌘" : "Win");
  parts.push(chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return isMac ? parts.join("") : parts.join("+");
}

const SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function PlanIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  );
}

function SplitRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </svg>
  );
}

function SplitDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} {...SVG_PROPS}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 12h18" />
    </svg>
  );
}

const BUTTON_CLASS =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60";

function PlanButton({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const [source, setSource] = useState<PlanSource>(null);
  const [shortcuts, setShortcuts] = useState({ panel: "", splitRight: "", splitDown: "" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const refresh = useCallback(() => {
    void rpc
      .call("plan_status", { threadId })
      .then((status) => {
        setSource(status.source);
        setShortcuts(status.shortcuts);
      })
      .catch(() => {});
  }, [rpc, threadId]);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  useRealtime(PLAN_CHANGED_CHANNEL, (payload) => {
    const changed = (payload as { threadId?: unknown } | null)?.threadId;
    if (changed === threadId) refresh();
  });

  const open = useCallback(
    async (mode: OpenMode = "panel") => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        if (mode === "panel") {
          const result = await rpc.call("plan_prepare", { threadId });
          setSource(result.source);
          if (!result.source) {
            toast.message("No plan for this thread yet", {
              description: "Start a turn with /plan, or wait for the agent to propose one.",
            });
            return;
          }
          const accepted = nav.experimental_openFilePreview({
            target: { kind: "thread-storage", threadId, path: result.fileName },
            location: null,
          });
          if (!accepted) toast.error("Could not open the plan in this view");
          return;
        }
        const result = await rpc.call("plan_split", { threadId, split: mode });
        setSource(result.source);
        if (!result.source) {
          toast.message("No plan for this thread yet", {
            description: "Start a turn with /plan, or wait for the agent to propose one.",
          });
          return;
        }
        if (result.delivered === 0) toast.error("No bb window accepted the split");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [nav, rpc, threadId],
  );

  // Palette row and shortcut both arrive here; act only for our thread.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId: string | null; mode?: OpenMode }>).detail;
      const requested = detail?.threadId ?? null;
      if (requested === threadId || (requested === null && threadIdFromLocation() === threadId)) {
        void open(detail?.mode ?? "panel");
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [open, threadId]);

  useEffect(() => {
    const bindings: Array<{ chord: Chord; mode: OpenMode }> = [];
    for (const [value, mode] of [
      [shortcuts.panel, "panel"],
      [shortcuts.splitRight, "right"],
      [shortcuts.splitDown, "down"],
    ] as const) {
      const chord = parseChord(value);
      if (chord) bindings.push({ chord, mode });
    }
    if (bindings.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (threadIdFromLocation() !== threadId) return;
      // Most specific first so mod+shift+d is not swallowed by mod+d.
      const hit = [...bindings]
        .sort((a, b) => Number(b.chord.shift) + Number(b.chord.alt) - (Number(a.chord.shift) + Number(a.chord.alt)))
        .find(({ chord }) => matchesChord(event, chord));
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      void open(hit.mode);
    };
    // Capture phase so the chord wins over bb's own document handlers.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, shortcuts, threadId]);

  const withHint = (label: string, value: string) => {
    const hint = formatChord(value);
    return hint ? `${label} (${hint})` : label;
  };
  const panelTitle = withHint(source ? "Open plan in panel" : "No plan yet", shortcuts.panel);
  const rightTitle = withHint("Open plan in a pane to the right", shortcuts.splitRight);
  const downTitle = withHint("Open plan in a pane below", shortcuts.splitDown);
  const tone = source ? "text-foreground" : "text-muted-foreground";

  return (
    <div className="flex items-center" data-plan-source={source ?? "none"}>
      <button
        type="button"
        onClick={() => void open("panel")}
        disabled={busy}
        aria-label={panelTitle}
        title={panelTitle}
        className={`${BUTTON_CLASS} ${tone}`}
      >
        <PlanIcon className="size-4" />
        <span className="hidden md:inline">Plan</span>
        {source ? <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" /> : null}
      </button>
      <button
        type="button"
        onClick={() => void open("right")}
        disabled={busy}
        aria-label={rightTitle}
        title={rightTitle}
        className={`${BUTTON_CLASS} ${tone} px-1.5`}
      >
        <SplitRightIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => void open("down")}
        disabled={busy}
        aria-label={downTitle}
        title={downTitle}
        className={`${BUTTON_CLASS} ${tone} px-1.5`}
      >
        <SplitDownIcon className="size-4" />
      </button>
    </div>
  );
}

const PLAN_CHANGED_CHANNEL = "plan-changed";

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "plan",
    title: "Plan",
    component: PlanButton,
  });

  app.slots.commandPaletteAction({
    id: "open-plan",
    title: "Plan Pane: open plan in this thread's panel",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => requestOpen(threadId, "panel"),
  });
  app.slots.commandPaletteAction({
    id: "open-plan-right",
    title: "Plan Pane: open plan in a pane to the right",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => requestOpen(threadId, "right"),
  });
  app.slots.commandPaletteAction({
    id: "open-plan-down",
    title: "Plan Pane: open plan in a pane below",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => requestOpen(threadId, "down"),
  });
});
