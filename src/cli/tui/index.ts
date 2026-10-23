/**
 * TUI Module
 *
 * A terminal user interface system for Context_Expert chat mode.
 * Provides fixed screen regions for status, chat, and input.
 *
 * Architecture:
 * - TerminalRegionManager: ANSI scroll regions for fixed layout
 * - StatusLineRenderer: Status bar with mode, context, cost
 * - ChatAreaManager: Scrollable message display
 * - InputManager: Readline wrapper with TUI coordination
 * - TUIController: Orchestrates all components
 *
 * Usage:
 * ```typescript
 * import { TUIController, startTUI } from './tui/index.js';
 *
 * // Simple usage with startTUI
 * const tui = await startTUI({
 *   model: { name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
 *   project: 'my-project',
 *   completer: myTabCompleter,
 *   onLine: async (line) => {
 *     // Handle user input
 *   },
 * });
 *
 * // Or manual control with TUIController
 * const tui = new TUIController({ ... });
 * tui.onLine(handler);
 * tui.start(completer);
 * ```
 */

// Types
export {
  
  AgentPhase,
  
  
  
  
  
  
  
  
  
  
  
} from './types.js';

// Terminal Region Manager
;

// Status Line Renderer
;

// Chat Area Manager
;

// Input Manager
;

// TUI Controller (main integration point)
export {
  TUIController,
  
  type StreamChunk,
  
  
} from './controller.js';
