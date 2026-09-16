// bb-plugin-plan-pane — frontend.
//
// Two jobs, both scoped to the window you are looking at:
//   1. "Plan" button / Mod+Shift+L: open this thread's plan.md in the panel.
//   2. Split buttons / Mod+D / Mod+Shift+D: open a NEW THREAD in a pane to the
//      right or below, iTerm/Ghostty style. bb only exposes its split layout
//      through the sidebar's "New thread" control (Mod-click = split right,
//      drag to a pane edge = split on that side), so we drive those two paths
//      with synthetic events.
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

const PLAN_CHANGED_CHANNEL = "plan-changed";
/** Window event used by palette rows and shortcuts to reach the mounted header control. */
const ACTION_EVENT = "plan-pane:action";

type Action = "plan" | "split-right" | "split-down";

function threadIdFromLocation(): string | null {
  const match = /\/threads\/(thr_[a-z0-9]+)/i.exec(window.location.pathname);
  return match ? match[1] : null;
}

function requestAction(threadId: string | null, action: Action) {
  window.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail: { threadId, action } }));
}

// ---------------------------------------------------------------------------
// Keyboard chords
// ---------------------------------------------------------------------------

interface Chord {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

const IS_MAC = /mac|iphone|ipad/i.test(navigator.platform);

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
  const modPressed = IS_MAC ? event.metaKey : event.ctrlKey;
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
  const parts: string[] = [];
  if (chord.ctrl) parts.push(IS_MAC ? "⌃" : "Ctrl");
  if (chord.alt) parts.push(IS_MAC ? "⌥" : "Alt");
  if (chord.shift) parts.push(IS_MAC ? "⇧" : "Shift");
  if (chord.mod) parts.push(IS_MAC ? "⌘" : "Ctrl");
  if (chord.meta) parts.push(IS_MAC ? "⌘" : "Win");
  parts.push(chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return IS_MAC ? parts.join("") : parts.join("+");
}

// ---------------------------------------------------------------------------
// Driving bb's split layout through the sidebar "New thread" control
// ---------------------------------------------------------------------------

function findNewThreadButton(): HTMLButtonElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label^="New thread"]'));
  // Prefer the sidebar copy (it carries the split handlers); skip plugin toolbars.
  return (
    candidates.find((button) => button.closest('[data-sidebar="sidebar"], [data-sidebar="content"]') !== null) ??
    candidates[0] ??
    null
  );
}

function pointerInit(x: number, y: number): PointerEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  };
}

const settle = (ms = 30) =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => window.setTimeout(resolve, ms));
  });

// bb persists its split layout under this key (session storage first, then
// local storage). Read-only here: writes would not notify bb's store.
const LAYOUT_KEY = "bb.splitLayout";

interface LayoutNode {
  type: "pane" | "split";
  content?: { kind: string };
  children?: LayoutNode[];
}

function readLayout(): { raw: string | null; hasNewThreadPane: boolean; paneCount: number } {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(LAYOUT_KEY) ?? window.localStorage.getItem(LAYOUT_KEY);
  } catch {
    raw = null;
  }
  let hasNewThreadPane = false;
  let paneCount = 0;
  const walk = (node: LayoutNode | undefined) => {
    if (!node) return;
    if (node.type === "pane") {
      paneCount += 1;
      if (node.content?.kind === "new-thread") hasNewThreadPane = true;
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  try {
    const parsed = raw ? (JSON.parse(raw) as { layout?: { root?: LayoutNode } }) : null;
    walk(parsed?.layout?.root);
  } catch {
    // ignore malformed storage
  }
  return { raw, hasNewThreadPane, paneCount };
}

/** Mod-click the sidebar "New thread" button: bb opens the composer in a pane to the right. */
function splitNewThreadRight(): boolean {
  const button = findNewThreadButton();
  if (!button) return false;
  button.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, metaKey: IS_MAC, ctrlKey: !IS_MAC }),
  );
  return true;
}

/**
 * Replay bb's drag-to-split gesture: pointerdown on "New thread", move into the
 * target pane's bottom zone, release. bb's drag manager listens on window and
 * resolves the pane with elementsFromPoint, so synthetic events suffice.
 */
type SplitBelowResult =
  | { ok: true }
  | { ok: false; reason: "no-button" | "no-pane" | "already-open" | "no-change"; detail?: string };

async function splitNewThreadBelow(anchor: HTMLElement | null): Promise<SplitBelowResult> {
  const button = findNewThreadButton();
  if (!button) return { ok: false, reason: "no-button" };
  const before = readLayout();
  if (before.hasNewThreadPane) return { ok: false, reason: "already-open" };

  const pane =
    anchor?.closest<HTMLElement>("[data-split-pane-id]") ??
    document.querySelector<HTMLElement>("[data-split-pane-id]") ??
    document.querySelector<HTMLElement>("main");
  if (!pane) return { ok: false, reason: "no-pane" };

  const source = button.getBoundingClientRect();
  const target = pane.getBoundingClientRect();
  const startX = source.left + source.width / 2;
  const startY = source.top + source.height / 2;
  const midX = target.left + target.width / 2;
  // Bottom zone is the lower 30% of the pane; stay clear of left/right zones (outer 28%).
  const dropY = target.top + target.height * 0.9;

  const diagnostics: string[] = [];
  button.dispatchEvent(new PointerEvent("pointerdown", pointerInit(startX, startY)));
  await settle();
  // First move is horizontal so the gesture engages (bb requires |dx| > |dy| past the sidebar edge).
  document.dispatchEvent(new PointerEvent("pointermove", pointerInit(midX, startY)));
  await settle();
  diagnostics.push(document.querySelector("[data-split-drag-label]") ? "engaged" : "not engaged");
  document.dispatchEvent(new PointerEvent("pointermove", pointerInit(midX, dropY)));
  await settle();
  const label = document.querySelector("[data-split-drag-label]")?.textContent?.trim();
  diagnostics.push(label ? `zone: ${label}` : "no drop zone");
  document.dispatchEvent(new PointerEvent("pointerup", pointerInit(midX, dropY)));
  await settle(120);

  const after = readLayout();
  if (after.raw !== before.raw && after.paneCount > before.paneCount) return { ok: true };
  return { ok: false, reason: "no-change", detail: diagnostics.join(", ") };
}

// ---------------------------------------------------------------------------
// Icons and header control
// ---------------------------------------------------------------------------

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

function HeaderControls({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
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

  const run = useCallback(
    async (action: Action) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        if (action === "split-right") {
          if (!splitNewThreadRight()) toast.error("Open the sidebar first (⌘\\) so bb can create the split");
          return;
        }
        if (action === "split-down") {
          const result = await splitNewThreadBelow(rootRef.current);
          if (result.ok) return;
          if (result.reason === "no-button") {
            toast.error("Open the sidebar first (⌘\\) so bb can create the split");
          } else if (result.reason === "already-open") {
            toast.message("bb already has a new-thread pane open", {
              description: "bb allows one at a time. Use it, or close it with ⌘W, then try again.",
            });
            splitNewThreadRight(); // focuses the existing new-thread pane
          } else if (result.reason === "no-pane") {
            toast.error("Could not find the current pane to split");
          } else {
            toast.error(`Split below did not take (${result.detail ?? "unknown"})`);
          }
          return;
        }
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
    },
    [nav, rpc, threadId],
  );

  // Palette rows and shortcuts arrive here; act only for the thread in view.
  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId: string | null; action: Action }>).detail;
      if (!detail) return;
      const requested = detail.threadId ?? null;
      if (requested === threadId || (requested === null && threadIdFromLocation() === threadId)) {
        void run(detail.action);
      }
    };
    window.addEventListener(ACTION_EVENT, onAction);
    return () => window.removeEventListener(ACTION_EVENT, onAction);
  }, [run, threadId]);

  useEffect(() => {
    const bindings: Array<{ chord: Chord; action: Action }> = [];
    for (const [value, action] of [
      [shortcuts.panel, "plan"],
      [shortcuts.splitRight, "split-right"],
      [shortcuts.splitDown, "split-down"],
    ] as const) {
      const chord = parseChord(value);
      if (chord) bindings.push({ chord, action });
    }
    if (bindings.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (threadIdFromLocation() !== threadId) return;
      // Most specific first so mod+shift+d is not swallowed by mod+d.
      const hit = [...bindings]
        .sort(
          (a, b) =>
            Number(b.chord.shift) + Number(b.chord.alt) - (Number(a.chord.shift) + Number(a.chord.alt)),
        )
        .find(({ chord }) => matchesChord(event, chord));
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      void run(hit.action);
    };
    // Capture phase so the chord wins over bb's own document handlers.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [run, shortcuts, threadId]);

  const withHint = (label: string, value: string) => {
    const hint = formatChord(value);
    return hint ? `${label} (${hint})` : label;
  };
  const planTitle = withHint(source ? "Open plan in panel" : "No plan yet", shortcuts.panel);
  const rightTitle = withHint("New thread in a pane to the right", shortcuts.splitRight);
  const downTitle = withHint("New thread in a pane below", shortcuts.splitDown);

  return (
    <div ref={rootRef} className="flex items-center" data-plan-source={source ?? "none"}>
      <button
        type="button"
        onClick={() => void run("plan")}
        disabled={busy}
        aria-label={planTitle}
        title={planTitle}
        className={`${BUTTON_CLASS} ${source ? "text-foreground" : "text-muted-foreground"}`}
      >
        <PlanIcon className="size-4" />
        <span className="hidden md:inline">Plan</span>
        {source ? <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" /> : null}
      </button>
      <button
        type="button"
        onClick={() => void run("split-right")}
        disabled={busy}
        aria-label={rightTitle}
        title={rightTitle}
        className={`${BUTTON_CLASS} px-1.5 text-muted-foreground`}
      >
        <SplitRightIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => void run("split-down")}
        disabled={busy}
        aria-label={downTitle}
        title={downTitle}
        className={`${BUTTON_CLASS} px-1.5 text-muted-foreground`}
      >
        <SplitDownIcon className="size-4" />
      </button>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "plan",
    title: "Plan Pane",
    component: HeaderControls,
  });

  app.slots.commandPaletteAction({
    id: "open-plan",
    title: "Plan Pane: open plan in this thread's panel",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => requestAction(threadId, "plan"),
  });
  app.slots.commandPaletteAction({
    id: "split-right",
    title: "Plan Pane: new thread in a pane to the right",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => requestAction(threadId, "split-right"),
  });
  app.slots.commandPaletteAction({
    id: "split-down",
    title: "Plan Pane: new thread in a pane below",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => requestAction(threadId, "split-down"),
  });
});
