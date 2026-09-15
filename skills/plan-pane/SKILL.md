---
name: plan-pane
description: "How the Plan Pane plugin opens proposed plans in a split pane, and how to re-open one with `bb plan-pane open`."
---

# Plan Pane

When an agent proposes a plan, Plan Pane writes the plan markdown to the
thread's storage as `plan.md` and surfaces it beside the chat. Nothing is
required from the agent; this happens automatically.

Two signals are covered:

- A provider-native plan approval (Claude Code's plan review). The pane opens
  the moment the approval is pending.
- A `/plan` turn that ends with a plain message and no approval (Codex today).
  The pane opens when that turn goes idle, using the final assistant message.

## Commands

- `bb plan-pane open [thread-id] [--split right|down|left|top|replace]`
  Open the thread's plan in a split pane right now, regardless of `mode`: the
  pending approval if one exists, else the final message of the latest `/plan`
  turn, else the `plan.md` saved earlier. Inside a BB thread the thread ID is
  optional.

## Settings

Edit under Settings → Installed plugins → Plan Pane, or with
`bb plugin config plan-pane set <key> <value>`:

- `enabled` (boolean, default `true`) — auto-open plans.
- `mode` (`tab` | `split`, default `tab`) — `tab` pins `plan.md` into that
  thread's own panel, visible when you view the thread. `split` uses bb's
  broadcast open, which splits every connected window even while you are
  viewing another thread.
- `textPlans` (boolean, default `true`) — also open plans that arrive as plain
  text from providers without plan approvals.
- `split` (`right` | `down` | `left` | `top` | `replace`, default `right`) —
  pane placement for `split` mode and `bb plan-pane open`. `down` gives a
  horizontal split.
- `fileName` (default `plan.md`) — file name inside thread storage.
