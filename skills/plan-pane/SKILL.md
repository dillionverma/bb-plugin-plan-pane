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

## Header controls, palette rows, and shortcuts (current window only)

- **Plan** button, `Mod+Shift+L`, palette "Plan Pane: open plan in this
  thread's panel": opens `plan.md` in the panel. A dot on the button means a
  plan exists (pending approval, recent `/plan` turn, or saved `plan.md`).
- **Split-right** icon, `Mod+D`, palette "…new thread in a pane to the
  right": opens a fresh new-thread composer beside the current thread.
- **Split-below** icon, `Mod+Shift+D`, palette "…new thread in a pane below":
  same, stacked under the current thread.

Splits reuse bb's sidebar "New thread" split controls, so bb's sidebar must be
visible (`Mod+\`). bb binds `Mod+D` to the diff toggle by default; move it
with `bb settings keyboard set diff.toggle mod+shift+g`. For `Mod+W` to close
the active pane: `bb settings keyboard set pane.close mod+w` and
`bb settings keyboard set panel.close mod+shift+w`. Chords are plugin-owned
settings (`shortcut`, `splitRightShortcut`, `splitDownShortcut`); blank one
to disable it.

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
- `shortcut` (default `mod+shift+l`), `splitRightShortcut` (default `mod+d`),
  `splitDownShortcut` (default `mod+shift+d`) — chords; blank disables.
- `fileName` (default `plan.md`) — file name inside thread storage.
