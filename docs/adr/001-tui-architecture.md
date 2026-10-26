# ADR 001: TUI Architecture for `ctx chat`

**Status**: Accepted
**Date**: 2026-02-05
**Context**: Ticket #109 in the original Context Expert repository, TUI Architecture

## Context

The `ctx chat` command used a basic readline REPL. Users needed:

- A fixed status bar showing the model, the working directory and git branch,
  how full the context window is, the turn count, what the agent is doing, and
  indexing progress
- A scrollable chat area for messages and streaming answers
- An input line that stays in place while output scrolls

The challenge is a 3-region terminal layout where the chat area scrolls on its
own while the status bar and input line stay fixed.

## Decision

Use **manual ANSI escape sequences** (DECSTBM scroll regions) instead of a
terminal UI framework such as Ink or Blessed. The code is in `src/cli/tui/`;
the regions are managed by `terminal-regions.ts`.

### Layout

```
Row 1     +-------------------------------+
          |                               |
          |     Chat Area (scrolls)       |  <- DECSTBM scroll region, rows 1 to N-2
          |                               |
Row N-2   +-------------------------------+
Row N-1   | Status Bar (fixed)            |  <- written in place (see below)
Row N     | Input Area (fixed, readline)  |  <- Node's readline
```

The status bar and input area are one line each by default (both heights are
configurable). Terminals shorter than 3 rows are treated as 3 rows so the
region bounds never go negative.

### Key Technique: DECSTBM Scroll Regions

`CSI n;m r` (Set Top and Bottom Margins) restricts scrolling to rows n through
m. Content written to the chat area scrolls within that region; the status bar
and input line below it stay where they are.

### Writing Without Flicker or Collisions

- **Status bar**: synchronized output on (`CSI ?2026h`), save cursor
  (`ESC 7`), move to the status row with CUP (`CSI row;col H`), clear the line,
  write, restore cursor (`ESC 8`), synchronized output off (`CSI ?2026l`). The
  terminal draws the update in one frame.
- **Chat messages**: save cursor, CUP to the last row of the scroll region,
  write a newline (which scrolls the region up a line), write the message,
  restore cursor.
- **Streaming answers**: CUP only, no save/restore. A terminal has a single
  save slot, so a status bar update arriving mid-stream would otherwise
  overwrite the saved position and send the stream to the wrong row.

### Resize and Exit

On a terminal resize the regions are recomputed and the scroll region is set
again. A closed stdout (`EPIPE`, for example when piped into `head`) is ignored
rather than crashing. On exit the scroll region is reset to the full screen.
An alternate screen buffer is supported but off by default, so the
conversation stays in the terminal's scrollback.

## Alternatives Considered

### Ink (React for CLI)

- **Pros**: Declarative component model, handles layout automatically
- **Cons**: Brings React and its reconciler into a CLI that otherwise prints
  with chalk and ora; re-rendering adds latency to token-by-token streaming

### Blessed / blessed-contrib

- **Pros**: Full widget toolkit with borders, scrollable panels
- **Cons**: Unmaintained (last release, 0.1.81, in 2015), heavy dependency,
  complex API for a simple 3-region layout

### Alternate screen with full redraws (no scroll regions)

- **Pros**: Simpler: redraw the whole screen each frame
- **Cons**: Flickers on fast updates, loses scrollback history, more CPU for
  full redraws during streaming

## Consequences

### Positive

- No runtime dependencies beyond chalk and Node's readline
- Full control over cursor positioning and scroll behavior
- Streaming writes go straight to stdout, with no re-render step
- Small: about 450 lines when adopted; about 2,300 in `src/cli/tui/` today,
  status bar, chat area and input handling included

### Negative

- More low-level code to maintain (ANSI sequences, region math)
- Edge cases are handled by hand: resize, closed stdout, tiny terminals
- No ready-made widget library for future complex UIs

### Mitigations

- 116 tests across the TUI's five modules (terminal regions, status line, chat
  area, input manager, controller) cover region bounds, ANSI output and the
  edge cases above
- Escape sequences are defined once, as the `ANSI` constants in
  `terminal-regions.ts`
- `--no-tui` switches to the classic readline REPL, which is also used
  automatically when stdout is not a terminal (for example when piped)

## References

- [DECSTBM: Set Top and Bottom Margins (VT510 reference)](https://vt100.net/docs/vt510-rm/DECSTBM.html)
- [Synchronized output (mode 2026) specification](https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036)
