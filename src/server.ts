// bb-plugin-plan-pane — open a thread's proposed plan in a split pane.
//
// bb fires `interaction.pending` for every provider (Claude Code, Codex, …)
// when an agent asks the user to approve a plan. This plugin listens for
// that event, writes the plan markdown into the thread's storage, and opens
// it in a split pane next to the chat so the plan is easy to read and review.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const SPLIT_OPTIONS = ["right", "down", "left", "top", "replace"] as const;
type Split = (typeof SPLIT_OPTIONS)[number];

const MODE_OPTIONS = ["tab", "split"] as const;
type Mode = (typeof MODE_OPTIONS)[number];

const PLAN_FILE_NAME = "plan.md";

/** Realtime channel the header button listens on; payload is `{ threadId }`. */
const PLAN_CHANGED = "plan-changed";

const planSourceSchema = z.enum(["pending", "text", "saved"]).nullable();
export type PlanSource = z.infer<typeof planSourceSchema>;

export const rpcContract = defineRpcContract({
  /** Is there a plan to show for this thread, and where would it come from? */
  plan_status: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({
      source: planSourceSchema,
      fileName: z.string(),
      shortcuts: z.object({ panel: z.string(), splitRight: z.string(), splitDown: z.string() }),
    }),
  },
  /** Resolve the plan, write plan.md into thread storage, and return where it is. */
  plan_prepare: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ source: planSourceSchema, fileName: z.string() }),
  },
});

/** Narrow a pending interaction down to a plan-approval request. */
function planFromInteraction(interaction: unknown): string | null {
  if (!interaction || typeof interaction !== "object") return null;
  const payload = (interaction as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return null;
  if ((payload as { kind?: unknown }).kind !== "approval") return null;
  const subject = (payload as { subject?: unknown }).subject;
  if (!subject || typeof subject !== "object") return null;
  if ((subject as { kind?: unknown }).kind !== "plan") return null;
  const plan = (subject as { plan?: unknown }).plan;
  return typeof plan === "string" && plan.trim().length > 0 ? plan : null;
}

/**
 * Did this `client/turn/requested` event enter plan mode? bb records the
 * builtin `/plan` composer action as a command mention on the input, and
 * newer builds also stamp `execution.promptMode`.
 */
function isPlanModeTurnRequest(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const execution = (data as { execution?: { promptMode?: unknown } }).execution;
  if (execution && execution.promptMode === "plan") return true;
  const input = (data as { input?: unknown }).input;
  if (!Array.isArray(input)) return false;
  return input.some((part) => {
    const mentions = (part as { mentions?: unknown })?.mentions;
    if (!Array.isArray(mentions)) return false;
    return mentions.some((mention) => {
      const resource = (mention as { resource?: { kind?: unknown; name?: unknown } })?.resource;
      return resource?.kind === "command" && resource?.name === "plan";
    });
  });
}

/** Did a provider-native plan approval happen in this turn? */
function isPlanInteractionLifecycle(data: unknown): boolean {
  const interaction = (data as { interaction?: unknown } | null)?.interaction;
  return planFromInteraction(interaction) !== null;
}

function parseMode(value: unknown): Mode {
  return MODE_OPTIONS.includes(value as Mode) ? (value as Mode) : "tab";
}

function parseSplit(value: unknown): Split {
  return SPLIT_OPTIONS.includes(value as Split) ? (value as Split) : "right";
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Auto-open plans when they are ready for review",
      default: true,
    },
    textPlans: {
      type: "boolean",
      label: "Also open plans that arrive as plain text (Codex and providers without plan approvals)",
      default: true,
    },
    mode: {
      type: "select",
      label: "How to show the plan",
      // tab: pin plan.md into that thread's own panel (only visible when you
      //      view the thread). split: bb's broadcast open, which splits every
      //      connected window even when you are viewing another thread.
      options: [...MODE_OPTIONS],
      default: "tab",
    },
    split: {
      type: "select",
      label: "Pane placement (split mode and `bb plan-pane open`)",
      options: [...SPLIT_OPTIONS],
      default: "right",
    },
    shortcut: {
      type: "string",
      label: "Shortcut: open plan in this thread's panel (blank disables)",
      experimental_schema: z
        .string()
        .trim()
        .max(40)
        .regex(/^$|^((mod|ctrl|control|alt|shift|meta|cmd)\+)*[a-z0-9,.;'/\\\[\]`-]$/i, "Use modifiers plus one key, like mod+shift+l"),
      default: "mod+shift+l",
    },
    splitRightShortcut: {
      type: "string",
      label: "Shortcut: new thread in a pane to the right (iTerm/Ghostty style; blank disables)",
      experimental_schema: z
        .string()
        .trim()
        .max(40)
        .regex(/^$|^((mod|ctrl|control|alt|shift|meta|cmd)\+)*[a-z0-9,.;'/\\\[\]`-]$/i, "Use modifiers plus one key, like mod+d"),
      default: "mod+d",
    },
    splitDownShortcut: {
      type: "string",
      label: "Shortcut: new thread in a pane below (blank disables)",
      experimental_schema: z
        .string()
        .trim()
        .max(40)
        .regex(/^$|^((mod|ctrl|control|alt|shift|meta|cmd)\+)*[a-z0-9,.;'/\\\[\]`-]$/i, "Use modifiers plus one key, like mod+shift+d"),
      default: "mod+shift+d",
    },
    fileName: {
      type: "string",
      label: "Plan file name (inside thread storage)",
      experimental_schema: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .regex(/^[A-Za-z0-9._-]+$/, "Use a plain file name, no slashes"),
      default: PLAN_FILE_NAME,
    },
  });

  // Interactions can be re-announced (e.g. on server restart); open each once.
  const seen = new Set<string>();

  async function writePlanFile(threadId: string, plan: string, fileName: string): Promise<string> {
    const location = await bb.sdk.threads.storageLocation({ threadId });
    const absolutePath = `${location.storageRootPath.replace(/\/+$/, "")}/${fileName}`;
    await bb.sdk.files.write({
      hostId: location.hostId,
      path: absolutePath,
      content: plan.endsWith("\n") ? plan : `${plan}\n`,
      createParents: true,
    });
    return absolutePath;
  }

  /** Broadcast: open the thread with the plan file in a split, in every window. */
  async function openSplit(threadId: string, fileName: string, split: Split): Promise<number> {
    const result = await bb.sdk.threads.open({
      threadId,
      split,
      file: { source: "thread-storage", path: fileName, lineNumber: null },
    });
    return result.delivered;
  }

  /** Quiet: persist a plan.md tab in the thread's own panel (same tab bb creates for a file open). */
  async function pinTab(threadId: string, environmentId: string | null, fileName: string): Promise<boolean> {
    const current = await bb.sdk.threads.tabs.get({ threadId });
    const alreadyPinned = current.tabs.some(
      (tab) =>
        tab.kind === "plugin-panel" &&
        tab.fileOpenerOwner?.kind === "thread-storage-file-preview" &&
        tab.fileOpenerOwner.tab.path === fileName,
    );
    if (alreadyPinned) return false;
    const paramsJson = JSON.stringify({
      path: fileName,
      source: { kind: "thread-storage", environmentId, projectId: null, threadId },
    });
    await bb.sdk.threads.tabs.update({
      threadId,
      expectedRevision: current.revision,
      tabs: [
        ...current.tabs,
        {
          kind: "plugin-panel",
          id: `plugin-panel:${encodeURIComponent(`file-manager:file-opener:preview:${paramsJson}`)}:none`,
          pluginId: "file-manager",
          actionId: "file-opener:preview",
          title: fileName,
          paramsJson,
          fileOpenerOwner: {
            kind: "thread-storage-file-preview",
            environmentId,
            threadId,
            tab: { path: fileName, lineRange: null },
          },
        },
      ],
    });
    return true;
  }

  async function openPlan(
    threadId: string,
    plan: string,
    options: { environmentId: string | null; forceSplit?: Split | null } = { environmentId: null },
  ): Promise<{ path: string; detail: string }> {
    const { mode, split, fileName } = await settings.get();
    const path = await writePlanFile(threadId, plan, fileName);
    if (options.forceSplit || parseMode(mode) === "split") {
      const delivered = await openSplit(threadId, fileName, options.forceSplit ?? parseSplit(split));
      return { path, detail: `split in ${delivered} window(s)` };
    }
    const pinned = await pinTab(threadId, options.environmentId, fileName);
    return { path, detail: pinned ? "pinned as panel tab" : "panel tab already present" };
  }

  bb.events.on("interaction.pending", async ({ thread, interaction }) => {
    const plan = planFromInteraction(interaction);
    if (!plan) return;
    if (seen.has(interaction.id)) return;
    seen.add(interaction.id);
    if (seen.size > 500) seen.delete(seen.values().next().value as string);

    const { enabled } = await settings.get();
    if (!enabled) return;

    try {
      const { path, detail } = await openPlan(thread.id, plan, { environmentId: thread.environmentId });
      bb.realtime.publish(PLAN_CHANGED, { threadId: thread.id });
      bb.log.info(`opened plan for ${thread.id} at ${path} (${detail})`);
    } catch (error) {
      bb.log.error(`failed to open plan for ${thread.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  /**
   * Find the best plan for a thread: a pending approval, else the final
   * message of the latest /plan turn, else nothing (a saved plan.md may still
   * exist on disk; callers check that separately).
   */
  async function resolvePlan(threadId: string): Promise<{ source: "pending" | "text"; plan: string } | null> {
    const pending = await bb.sdk.threads.interactions.list({ threadId });
    const planInteraction = [...pending].reverse().find((interaction) => planFromInteraction(interaction) !== null);
    const pendingPlan = planInteraction ? planFromInteraction(planInteraction) : null;
    if (pendingPlan) return { source: "pending", plan: pendingPlan };

    const [turn] = await bb.sdk.threads.events.list({
      threadId,
      order: "desc",
      limit: "1",
      types: ["client/turn/requested"],
    });
    if (turn && isPlanModeTurnRequest(turn.data)) {
      const { output } = await bb.sdk.threads.output({ threadId });
      if (output && output.trim().length > 0) return { source: "text", plan: output };
    }
    return null;
  }

  async function savedPlanExists(threadId: string, fileName: string): Promise<boolean> {
    const location = await bb.sdk.threads.storageLocation({ threadId });
    const absolutePath = `${location.storageRootPath.replace(/\/+$/, "")}/${fileName}`;
    try {
      await bb.sdk.files.read({ hostId: location.hostId, path: absolutePath });
      return true;
    } catch {
      return false;
    }
  }

  bb.rpc.register(rpcContract, {
    async plan_status({ threadId }) {
      const { fileName, shortcut, splitRightShortcut, splitDownShortcut } = await settings.get();
      const shortcuts = { panel: shortcut, splitRight: splitRightShortcut, splitDown: splitDownShortcut };
      const resolved = await resolvePlan(threadId);
      if (resolved) return { source: resolved.source, fileName, shortcuts };
      const source: PlanSource = (await savedPlanExists(threadId, fileName)) ? "saved" : null;
      return { source, fileName, shortcuts };
    },
    async plan_prepare({ threadId }) {
      const { fileName } = await settings.get();
      const resolved = await resolvePlan(threadId);
      if (resolved) {
        await writePlanFile(threadId, resolved.plan, fileName);
        return { source: resolved.source, fileName };
      }
      const source: PlanSource = (await savedPlanExists(threadId, fileName)) ? "saved" : null;
      return { source, fileName };
    },
  });

  // Providers without a native plan approval (Codex today) answer a /plan
  // turn with a plain message. When such a turn goes idle, treat the final
  // assistant text as the plan.
  const handledTextTurns = new Set<string>();

  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    const { enabled, textPlans } = await settings.get();
    if (!enabled || !textPlans) return;
    const text = lastAssistantText?.trim() ?? "";
    if (text.length === 0) return;

    try {
      const [turn] = await bb.sdk.threads.events.list({
        threadId: thread.id,
        order: "desc",
        limit: "1",
        types: ["client/turn/requested"],
      });
      if (!turn || !isPlanModeTurnRequest(turn.data)) return;

      const key = `${thread.id}:${turn.seq}`;
      if (handledTextTurns.has(key)) return;

      // The provider already surfaced this plan as an approval; that path
      // opened it (see the interaction.pending listener above).
      const lifecycle = await bb.sdk.threads.events.list({
        threadId: thread.id,
        afterSeq: String(turn.seq),
        limit: "100",
        types: ["system/interaction/lifecycle"],
      });
      if (lifecycle.some((row) => isPlanInteractionLifecycle(row.data))) return;

      handledTextTurns.add(key);
      if (handledTextTurns.size > 500) handledTextTurns.delete(handledTextTurns.values().next().value as string);

      const { path, detail } = await openPlan(thread.id, text, { environmentId: thread.environmentId });
      bb.realtime.publish(PLAN_CHANGED, { threadId: thread.id });
      bb.log.info(`opened text plan for ${thread.id} at ${path} (${detail})`);
    } catch (error) {
      bb.log.error(`failed to open text plan for ${thread.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  bb.cli.register({
    name: "plan-pane",
    summary: "Re-open a thread's latest plan in a split pane",
    commands: [
      {
        name: "open",
        summary: "Open the pending or most recent plan of a thread (defaults to the current thread)",
        usage: "bb plan-pane open [thread-id] [--split right|down|left|top|replace]",
      },
    ],
    async run(argv, ctx) {
      const [command, ...rest] = argv;
      if (command !== "open") {
        return { exitCode: 1, stderr: "Usage: bb plan-pane open [thread-id] [--split <placement>]\n" };
      }
      let threadId = ctx.threadId ?? null;
      let splitOverride: Split | null = null;
      for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (arg === "--split") {
          splitOverride = parseSplit(rest[i + 1]);
          i += 1;
        } else if (arg && !arg.startsWith("-")) {
          threadId = arg;
        }
      }
      if (!threadId) {
        return { exitCode: 1, stderr: "Pass a thread ID or run inside a BB thread.\n" };
      }
      const resolved = await resolvePlan(threadId);
      const plan = resolved?.plan ?? null;
      const { fileName, split: configuredSplit } = await settings.get();
      const split = splitOverride ?? parseSplit(configuredSplit);
      if (!plan) {
        // Last resort: re-open a plan file this plugin wrote earlier.
        const location = await bb.sdk.threads.storageLocation({ threadId });
        const absolutePath = `${location.storageRootPath.replace(/\/+$/, "")}/${fileName}`;
        try {
          await bb.sdk.files.read({ hostId: location.hostId, path: absolutePath });
        } catch {
          return { exitCode: 1, stderr: `No pending, recent, or saved plan on ${threadId}.\n` };
        }
        const delivered = await openSplit(threadId, fileName, split);
        return { exitCode: 0, stdout: `Opened ${absolutePath} (split in ${delivered} window(s))\n` };
      }
      const path = await writePlanFile(threadId, plan, fileName);
      const delivered = await openSplit(threadId, fileName, split);
      return { exitCode: 0, stdout: `Opened ${path} (split in ${delivered} window(s))\n` };
    },
  });

  bb.log.info("plan-pane loaded");
}
