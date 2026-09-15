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

function threadIdFromLocation(): string | null {
  const match = /\/threads\/(thr_[a-z0-9]+)/i.exec(window.location.pathname);
  return match ? match[1] : null;
}

function requestOpen(threadId: string | null) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { threadId } }));
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

function PlanIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  );
}

function PlanButton({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const [source, setSource] = useState<PlanSource>(null);
  const [shortcut, setShortcut] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const refresh = useCallback(() => {
    void rpc
      .call("plan_status", { threadId })
      .then((status) => {
        setSource(status.source);
        setShortcut(status.shortcut);
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

  const open = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [nav, rpc, threadId]);

  // Palette row and shortcut both arrive here; act only for our thread.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const requested = (event as CustomEvent<{ threadId: string | null }>).detail?.threadId;
      if (requested === threadId || (requested === null && threadIdFromLocation() === threadId)) void open();
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [open, threadId]);

  useEffect(() => {
    const chord = parseChord(shortcut);
    if (!chord) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!matchesChord(event, chord)) return;
      if (threadIdFromLocation() !== threadId) return;
      event.preventDefault();
      void open();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, shortcut, threadId]);

  const hint = formatChord(shortcut);
  const label = source ? "Open plan" : "No plan yet";
  const title = hint ? `${label} (${hint})` : label;

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      aria-label={title}
      title={title}
      data-plan-source={source ?? "none"}
      className={[
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm transition-colors",
        "hover:bg-accent hover:text-accent-foreground disabled:opacity-60",
        source ? "text-foreground" : "text-muted-foreground",
      ].join(" ")}
    >
      <PlanIcon className="size-4" />
      <span className="hidden md:inline">Plan</span>
      {source ? <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" /> : null}
    </button>
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
    title: "Plan Pane: open plan for this thread",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => requestOpen(threadId),
  });
});
