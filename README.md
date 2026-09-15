# Plan Pane

A [bb](https://getbb.app) plugin that puts an agent's proposed plan beside the
chat the moment it is ready for review.

Works with every provider that asks for plan approval through bb (Claude Code,
Codex, …). No agent-side hooks or instructions needed.

## How it works

1. Plan Pane listens for two bb events:
   - `interaction.pending` with a plan approval (Claude Code plan review).
   - `thread.idle` after a `/plan` turn that produced no approval (Codex
     answers plan requests with a plain message today).
2. It writes the plan markdown to the thread's storage as `plan.md`.
3. It pins that file as a tab in the thread's panel (`mode = tab`, default), or
   opens it in a split pane in every window (`mode = split`).

## Install

```sh
bb plugin install git:https://github.com/dillionverma/bb-plugin-plan-pane.git
```

Or from a checkout:

```sh
git clone git@github.com:dillionverma/bb-plugin-plan-pane.git
cd bb-plugin-plan-pane
npm install
bb plugin install .
```

## Open it yourself

Three ways to open a thread's plan in the window you are looking at (never
other windows):

| Surface | How |
| ------- | --- |
| Thread header | Click the **Plan** button. A dot means a plan exists. |
| Command palette | `Mod+K`, then "Plan Pane: open plan for this thread". |
| Keyboard | `Mod+Shift+L` while viewing the thread (configurable, see `shortcut`). |

## Settings

| Key        | Default | Meaning                                                        |
| ---------- | ------- | -------------------------------------------------------------- |
| `enabled`  | `true`  | Auto-open plans.                                               |
| `mode`     | `tab`   | `tab` pins into the thread's panel; `split` splits every window. |
| `textPlans`| `true`  | Also open plans that arrive as plain text (no approval).       |
| `split`    | `right` | Placement for split mode and the CLI: `right`, `down`, `left`, `top`, `replace`. |
| `shortcut` | `mod+shift+l` | Chord for the header button; blank disables it.          |
| `fileName` | `plan.md` | File name written inside thread storage.                     |

```sh
bb plugin config plan-pane set split down
```

## CLI

```sh
bb plan-pane open [thread-id] [--split down]
```

Opens a thread's plan in a split pane right now (defaults to the current
thread): the pending approval if one exists, else the final message of the
latest `/plan` turn, else the `plan.md` saved earlier.

## Develop

```sh
npm install
npm run typecheck
bb plugin dev
```
