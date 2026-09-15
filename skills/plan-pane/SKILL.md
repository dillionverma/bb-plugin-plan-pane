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

## Opening a plan on demand (current window only)

- **Header buttons**: "Plan" plus two split icons sit in the thread header
  action row. A dot on "Plan" means a plan exists (pending approval, recent
  `/plan` turn, or a saved `plan.md`).
  - "Plan" opens `plan.md` in this window's panel only.
  - Split-right and split-below open it in a new pane. These use bb's split
    open, which reaches every connected bb window.
- **Command palette**: `Mod+K`, then "Plan Pane: …" (panel, pane right, pane
  below).
- **Keyboard shortcuts** (iTerm/Ghostty style, while viewing a thread):
  - `Mod+D` pane to the right (`splitRightShortcut`)
  - `Mod+Shift+D` pane below (`splitDownShortcut`)
  - `Mod+Shift+L` this thread's panel (`shortcut`)
  Blank a setting to disable it. bb's own shortcut table is fixed, so these
  bindings are plugin-owned and do not appear under Settings → Keyboard.
  Because bb binds `Mod+D` to the diff toggle by default, move that first:
  `bb settings keyboard set diff.toggle mod+shift+g`. To make `Mod+W` close
  the active pane instead of a panel tab:
  `bb settings keyboard set pane.close mod+w` and
  `bb settings keyboard set panel.close mod+shift+w`.

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
