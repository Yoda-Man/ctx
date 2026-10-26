/**
 * Status Line Renderer
 *
 * Renders a Claude Code-inspired status bar HUD with:
 * - Model name (prominent, first position)
 * - Location (working directory + git branch + dirty indicator)
 * - Context gauge (token usage visualization with bar)
 * - Turn counter (user-assistant exchange count)
 * - Activity indicator (phase icon + current tool/action)
 *
 * Design principles from agentic CLI UX research:
 * - "Transparency Over Magic" - users must always know what's happening
 * - "Progressive Disclosure" - essential info visible, details on demand
 * - Color encodes meaning (green=safe, yellow=caution, red=danger)
 */

import chalk, { type ChalkInstance } from 'chalk';
import { ANSI_ESCAPE_PATTERN } from './terminal-regions.js';
import {
  AgentPhase,
  type StatusLineState,
} from './types.js';

/**
 * Default status line state.
 * Provides sensible defaults for initialization.
 */
export const DEFAULT_STATUS_STATE: StatusLineState = {
  phase: AgentPhase.IDLE,
  tokens: {
    used: 0,
    total: 200000, // 200k default context window
    warningThreshold: 0.8,
    dangerThreshold: 0.95,
  },
  activity: {},
  model: {
    name: 'Unknown',
    provider: 'unknown',
  },
  project: null,
  gitBranch: null,
  gitDirty: false,
  workingDirectory: null,
  turnCount: 0,
};


/**
 * Phase icons for activity spinner.
 * Unicode characters that indicate current activity.
 */
const PHASE_ICONS: Record<AgentPhase, string> = {
  [AgentPhase.THINKING]: '◐', // Rotating moon phases work well
  [AgentPhase.TOOL_USE]: '⚡',
  [AgentPhase.STREAMING]: '▸',
  [AgentPhase.IDLE]: '●',
};

/**
 * Options for StatusLineRenderer.
 */
export interface StatusLineRendererOptions {
  /** Terminal width for truncation (default: 80) */
  terminalWidth?: number;
  /** Show git branch in status (default: true) */
  showGitBranch?: boolean;
  /** Show model name in status (default: true) */
  showModel?: boolean;
  /** Separator between status sections */
  separator?: string;
}

/**
 * Renders the status line for the TUI (Claude Code-inspired layout).
 *
 * Example output:
 * ```
 * qwen3.5:9b │ ~/projects/my-project main* │ ████░░░░░░ 42% │ 3 turns │ ⚡ Reading src/index.ts
 * ```
 */
export class StatusLineRenderer {
  private state: StatusLineState;
  private terminalWidth: number;
  private showGitBranch: boolean;
  /** Whether to show model name in status bar */
  readonly showModel: boolean;
  private separator: string;

  constructor(
    initialState: Partial<StatusLineState> = {},
    options: StatusLineRendererOptions = {}
  ) {
    this.state = { ...DEFAULT_STATUS_STATE, ...initialState };
    this.terminalWidth = options.terminalWidth ?? 80;
    this.showGitBranch = options.showGitBranch ?? true;
    this.showModel = options.showModel ?? true;
    this.separator = options.separator ?? chalk.dim(' │ ');
  }

  /**
   * Update state and return new rendered string.
   *
   * @param partial - Partial state update
   * @returns The rendered status line string
   */
  update(partial: Partial<StatusLineState>): string {
    // Deep merge for nested objects
    this.state = {
      ...this.state,
      ...partial,
      tokens: { ...this.state.tokens, ...partial.tokens },
      activity: { ...this.state.activity, ...partial.activity },
      model: { ...this.state.model, ...partial.model },
    };
    return this.render();
  }

  /**
   * Get current state.
   */
  getState(): StatusLineState {
    return { ...this.state };
  }

  /**
   * Set terminal width for truncation calculations.
   */
  setTerminalWidth(width: number): void {
    this.terminalWidth = width;
  }

  /**
   * Render the complete status line as a formatted string.
   *
   * Segment order (left = highest priority for truncation survival):
   * 1. Model name
   * 2. Location (path + branch + dirty)
   * 3. Context gauge (visual bar)
   * 4. Turn count
   * 5. Activity (with phase icon)
   * 6. Indexing status
   */
  render(): string {
    const parts: string[] = [];

    // Model name (first position, most prominent)
    const modelPart = this.renderModel();
    if (modelPart) {
      parts.push(modelPart);
    }

    // Location (working directory + git branch + dirty)
    const locationPart = this.renderLocation();
    if (locationPart) {
      parts.push(locationPart);
    }

    // Context gauge
    parts.push(this.renderContextGauge());

    // Turn count
    parts.push(this.renderTurns());

    // Activity (if active, with phase icon)
    const activityPart = this.renderActivity();
    if (activityPart) {
      parts.push(activityPart);
    }

    // Background indexing status (if active)
    const indexingPart = this.renderIndexingStatus();
    if (indexingPart) {
      parts.push(indexingPart);
    }

    // Progressive truncation: drop rightmost (least important) segments
    // until the line fits, preserving chalk colors on remaining segments.
    let line = parts.join(this.separator);
    while (parts.length > 1 && this.visibleLength(line) > this.terminalWidth) {
      parts.pop();
      line = parts.join(this.separator);
    }

    // Final character-level truncation only if a single segment overflows
    return this.truncate(line);
  }

  /**
   * Render model name.
   * Returns null if showModel is false or model is unknown.
   */
  private renderModel(): string | null {
    if (!this.showModel) {
      return null;
    }

    const { model } = this.state;
    if (!model.name || model.name === 'Unknown') {
      return null;
    }

    return chalk.bold(model.name);
  }

  /**
   * Render working directory path and git branch with dirty indicator.
   * Prefers workingDirectory over project name.
   */
  private renderLocation(): string | null {
    const { workingDirectory, project, gitBranch, gitDirty } = this.state;

    // Prefer workingDirectory; fall back to project name
    const pathDisplay = workingDirectory ?? project;
    if (!pathDisplay) {
      return null;
    }

    let display = chalk.bold(pathDisplay);

    if (this.showGitBranch && gitBranch) {
      const branchStr = gitDirty ? `${gitBranch}*` : gitBranch;
      display += ' ' + chalk.cyan(branchStr);
    }

    return display;
  }

  /**
   * Render the context gauge (token usage visualization).
   *
   * Visual design:
   * - Green when < 60% used
   * - Yellow when 60-80% used (warning zone)
   * - Red when > 80% used (danger zone)
   * - Bar uses █ (filled) and ░ (empty) characters
   */
  private renderContextGauge(): string {
    const { tokens } = this.state;
    const percentage = tokens.total > 0 ? tokens.used / tokens.total : 0;
    const percentDisplay = Math.round(percentage * 100);

    // Visual bar width (10 characters is a good balance)
    const barWidth = 10;
    const filledCount = Math.round(barWidth * Math.min(percentage, 1));
    const emptyCount = barWidth - filledCount;

    // Choose color based on thresholds
    let barColor: ChalkInstance;
    if (percentage >= tokens.dangerThreshold) {
      barColor = chalk.red;
    } else if (percentage >= tokens.warningThreshold) {
      barColor = chalk.yellow;
    } else if (percentage >= 0.6) {
      barColor = chalk.yellow;
    } else {
      barColor = chalk.green;
    }

    const filledBar = barColor('█'.repeat(filledCount));
    const emptyBar = chalk.dim('░'.repeat(emptyCount));
    const percentStr = barColor(`${percentDisplay}%`);

    return `Context: ${filledBar}${emptyBar} ${percentStr}`;
  }

  /**
   * Render the turn counter.
   */
  private renderTurns(): string {
    const { turnCount } = this.state;
    return chalk.dim(`${turnCount} turn${turnCount !== 1 ? 's' : ''}`);
  }

  /**
   * Render current activity description with phase icon prefix.
   * Returns null if no activity is in progress.
   */
  private renderActivity(): string | null {
    const { activity, phase } = this.state;

    // Only show activity when actively doing something
    if (phase === AgentPhase.IDLE) {
      return null;
    }

    const icon = PHASE_ICONS[phase];
    let text: string;

    if (activity.description) {
      text = activity.description;
    } else if (activity.tool) {
      text = `Using ${activity.tool}...`;
    } else {
      // Phase-based generic messages
      switch (phase) {
        case AgentPhase.THINKING:
          text = 'Thinking...';
          break;
        case AgentPhase.STREAMING:
          text = 'Responding...';
          break;
        case AgentPhase.TOOL_USE:
          text = 'Working...';
          break;
        default:
          return null;
      }
    }

    return chalk.dim(`${icon} ${text}`);
  }

  /**
   * Render background indexing status.
   */
  private renderIndexingStatus(): string | null {
    const { indexingStatus } = this.state;

    if (!indexingStatus) {
      return null;
    }

    const { projectName, progress, stage } = indexingStatus;
    const percent = Math.round(progress);

    return chalk.blue(`📦 Indexing ${projectName}: ${stage} ${percent}%`);
  }

  /**
   * Measure visible width of a string, excluding ANSI escape sequences.
   */
  private visibleLength(str: string): number {
    return str.replace(ANSI_ESCAPE_PATTERN, '').length;
  }

  /**
   * Truncate string to fit terminal width.
   * Strips ANSI codes to measure visible width, then truncates plain text
   * on overflow. Only used as a last resort when even a single segment
   * overflows — segment-level truncation in render() handles the common case.
   */
  private truncate(str: string): string {
    const visible = str.replace(ANSI_ESCAPE_PATTERN, '');
    if (visible.length <= this.terminalWidth) {
      return str;
    }
    // Strip ANSI and truncate plain text to avoid cutting mid-escape
    return visible.slice(0, this.terminalWidth - 1) + '…';
  }
}

/**
 * Create a pre-configured status line renderer.
 */
export function createStatusLineRenderer(
  initialState?: Partial<StatusLineState>,
  options?: StatusLineRendererOptions
): StatusLineRenderer {
  return new StatusLineRenderer(initialState, options);
}

/**
 * Describe a tool call for the status bar. ctx's agent has one tool,
 * retrieve_knowledge; anything else is named as it is.
 *
 * @example
 * toolToDescription('retrieve_knowledge', { query: 'auth flow' })
 * // => 'Searching: "auth flow"'
 */
export function toolToDescription(tool: string, args?: Record<string, unknown>): string {
  if (tool === 'retrieve_knowledge') {
    const query = typeof args?.query === 'string' ? args.query : 'codebase';
    return `Searching: "${query.slice(0, 40)}"`;
  }
  return `Using ${tool}`;
}
