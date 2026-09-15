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

| Surface | Plan in panel (this window) | New thread, pane right | New thread, pane below |
| ------- | --------------------------- | ---------------------- | ---------------------- |
| Thread header | **Plan** button (dot = plan exists) | split-right icon | split-below icon |
| Keyboard | `Mod+Shift+L` | `Mod+D` | `Mod+Shift+D` |
| Command palette | `Mod+K` → "Plan Pane: …" | same | same |

The split actions follow iTerm2/Ghostty: `Mod+D` puts a fresh new-thread
composer beside the current thread, `Mod+Shift+D` below it. They drive bb's
own split layout in this window only (bb never shows one thread in two panes,
so a split always holds something new). They need bb's sidebar visible, since
that is where bb exposes its split controls; the plugin tells you if it is
hidden.

bb binds `Mod+D` to the diff toggle out of the box, so move it once:

```sh
bb settings keyboard set diff.toggle mod+shift+g
# optional: Mod+W closes the active pane, Mod+Shift+W closes a panel tab
bb settings keyboard set pane.close mod+w
bb settings keyboard set panel.close mod+shift+w
```

## Settings

| Key        | Default | Meaning                                                        |
| ---------- | ------- | -------------------------------------------------------------- |
| `enabled`  | `true`  | Auto-open plans.                                               |
| `mode`     | `tab`   | `tab` pins into the thread's panel; `split` splits every window. |
| `textPlans`| `true`  | Also open plans that arrive as plain text (no approval).       |
| `split`    | `right` | Placement for split mode and the CLI: `right`, `down`, `left`, `top`, `replace`. |
| `shortcut` | `mod+shift+l` | Chord: open in this thread's panel; blank disables.      |
| `splitRightShortcut` | `mod+d` | Chord: new thread in a pane to the right.            |
| `splitDownShortcut` | `mod+shift+d` | Chord: new thread in a pane below.               |
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
