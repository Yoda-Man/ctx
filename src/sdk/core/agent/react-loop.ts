import type { LLMProvider, ChatMessage, ToolCall } from '../provider/types';
import type { Tool } from '../tool/types';
import type {
  ReActStep,
  
  Thought,
  Action,
  Observation,
  AgentRunOptions,
  
  Logger,
  StreamEvent,
} from './types';
import { noopLogger } from './types';
import {  ToolTimeoutError } from '../errors/errors';
import { ToolCallAggregator } from './tool-call-aggregator';
import type { ErrorRecoveryConfig } from './retry-types';
import { ErrorRecovery } from './error-recovery';

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * ReAct (Reasoning + Acting) loop implementation
 *
 * Executes the Thought -> Action -> Observation cycle:
 * 1. LLM generates a Thought (reasoning about what to do)
 * 2. LLM decides on an Action (which tool to use)
 * 3. Tool is executed and produces an Observation
 * 4. Loop repeats until LLM produces a final answer
 *
 * @example
 * ```typescript
 * const loop = new ReActLoop(llmProvider, tools, 10);
 * const { output, trace } = await loop.execute(messages);
 * console.log(trace.steps); // See the reasoning chain
 * ```
 */
export class ReActLoop {
  private readonly llm: LLMProvider;
  private readonly tools: Map<string, Tool>;
  private readonly maxIterations: number;
  private readonly logger: Logger;
  private readonly errorRecovery?: ErrorRecovery;

  constructor(
    llm: LLMProvider,
    tools: Tool[] = [],
    maxIterations: number = DEFAULT_MAX_ITERATIONS,
    logger: Logger = noopLogger,
    errorRecoveryConfig?: ErrorRecoveryConfig
  ) {
    this.llm = llm;
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.maxIterations = maxIterations;
    this.logger = logger;

    // Create error recovery if configured
    if (errorRecoveryConfig) {
      this.errorRecovery = new ErrorRecovery(errorRecoveryConfig);
    }
  }

  /**
   * Execute the ReAct loop with true token-by-token streaming
   *
   * Yields events as they occur during execution:
   * - `thought_delta`: Individual tokens as LLM generates reasoning
   * - `thought`: Complete thought after streaming finishes
   * - `action`: Tool being called
   * - `toolCall`: Tool call about to execute
   * - `observation`: Tool execution result
   * - `output_delta`: Individual tokens of final output
   * - `error`: Error occurred during streaming
   * - `done`: Completion with full trace
   *
   * NOTE: This is a generator function that cannot use arrow function syntax.
   * Do not pass this method as a callback directly - use .bind(this) if needed.
   *
   * @example
   * ```typescript
   * for await (const event of loop.executeStream(messages)) {
   *   if (event.type === 'thought_delta') {
   *     process.stdout.write(event.content); // Real-time display
   *   }
   * }
   * ```
   */

  async *executeStream(
    messages: ChatMessage[],
    options: AgentRunOptions = {}
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const maxIter = options.maxIterations ?? this.maxIterations;
    const steps: ReActStep[] = [];
    const startTime = Date.now();
    let totalTokens = 0;
    let iterations = 0;

    const conversationMessages = [...messages];
    const toolDefs = Array.from(this.tools.values()).map((t) => t.toJSON());
    const aggregator = new ToolCallAggregator();

    this.logger.debug('ReAct stream starting', { maxIterations: maxIter });

    while (iterations < maxIter) {
      iterations++;

      // Check for abort before each iteration
      if (options.signal?.aborted) {
        yield {
          type: 'error',
          error: 'Agent execution aborted',
          code: 'ABORTED',
          timestamp: Date.now(),
        };
        return;
      }

      // Stream response from LLM
      let contentBuffer = '';

      try {
        for await (const chunk of this.llm.streamChat(conversationMessages, {
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          signal: options.signal,
        })) {
          // Check abort during streaming
          if (options.signal?.aborted) {
            yield {
              type: 'error',
              error: 'Agent execution aborted',
              code: 'ABORTED',
              timestamp: Date.now(),
            };
            return;
          }

          switch (chunk.type) {
            case 'text':
              if (chunk.content) {
                contentBuffer += chunk.content;
                // Yield token-by-token for real-time display
                yield {
                  type: 'thought_delta',
                  content: chunk.content,
                  iteration: iterations,
                  timestamp: Date.now(),
                };
              }
              break;

            case 'tool_call':
              aggregator.process(chunk);
              break;

            case 'usage':
              if (chunk.usage?.totalTokens) {
                totalTokens += chunk.usage.totalTokens;
              }
              break;

            case 'done':
              // Stream complete, finalize tool calls below
              break;
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error('Stream error', { error: errorMessage });
        yield {
          type: 'error',
          error: errorMessage,
          code: 'STREAM_ERROR',
          timestamp: Date.now(),
        };
        return;
      }

      // Record complete thought
      if (contentBuffer) {
        const thought: Thought = {
          type: 'thought',
          content: contentBuffer,
          timestamp: Date.now(),
        };
        steps.push(thought);

        // Yield complete thought event
        yield {
          type: 'thought',
          content: contentBuffer,
          iteration: iterations,
          timestamp: thought.timestamp,
        };
      }

      // Get completed tool calls from aggregator
      const toolCalls = aggregator.finalize();

      // If no tool calls, we have the final answer
      if (toolCalls.length === 0) {
        yield {
          type: 'done',
          output: contentBuffer,
          trace: {
            steps,
            iterations,
            totalTokens,
            durationMs: Date.now() - startTime,
          },
        };
        return;
      }

      // Process tool calls
      for (const toolCall of toolCalls) {
        const action: Action = {
          type: 'action',
          tool: toolCall.name,
          input: toolCall.arguments,
          timestamp: Date.now(),
        };
        steps.push(action);

        // Yield action event
        yield {
          type: 'action',
          tool: toolCall.name,
          input: toolCall.arguments,
          iteration: iterations,
          timestamp: action.timestamp,
        };

        // Yield toolCall event before execution
        yield {
          type: 'toolCall',
          tool: toolCall.name,
          input: toolCall.arguments,
          iteration: iterations,
          timestamp: Date.now(),
        };

        // Execute tool and measure duration
        const toolStartTime = Date.now();
        const observation = await this.executeTool(toolCall, options.signal);
        const toolDurationMs = Date.now() - toolStartTime;
        steps.push(observation);

        // Yield observation event
        yield {
          type: 'observation',
          tool: toolCall.name,
          result: observation.result,
          success: observation.success,
          durationMs: toolDurationMs,
          iteration: iterations,
          timestamp: observation.timestamp,
        };

        // Add tool result to conversation
        conversationMessages.push({
          role: 'assistant',
          content: contentBuffer || '',
        });
        conversationMessages.push({
          role: 'tool',
          content: JSON.stringify(observation.result),
          toolCallId: toolCall.id,
          name: toolCall.name,
        });
      }
      // Reset aggregator for next iteration
      aggregator.reset();
    }

    // Max iterations exceeded
    yield {
      type: 'error',
      error: `ReAct loop exceeded maximum iterations (${maxIter})`,
      code: 'MAX_ITERATIONS',
      timestamp: Date.now(),
    };
  }

  /**
   * Execute a single tool call
   *
   * Uses arrow function syntax to preserve `this` binding.
   */
  private executeTool = async (
    toolCall: ToolCall,
    signal?: AbortSignal
  ): Promise<Observation> => {
    const tool = this.tools.get(toolCall.name);

    if (!tool) {
      return {
        type: 'observation',
        result: { error: `Tool "${toolCall.name}" not found` },
        success: false,
        timestamp: Date.now(),
      };
    }

    try {
      // Wrap execution with error recovery if configured
      const executeToolFn = async () => {
        const result = await tool.execute(toolCall.arguments, { signal });
        if (!result.success) {
          // Throw to trigger retry on tool-level failures
          throw new Error(result.error || 'Tool execution failed');
        }
        return result;
      };

      if (this.errorRecovery) {
        const recoveryResult = await this.errorRecovery.execute(
          executeToolFn,
          { toolName: toolCall.name, input: toolCall.arguments },
          signal
        );

        if (recoveryResult.success) {
          const result = recoveryResult.value as {
            success: boolean;
            data?: unknown;
            error?: string;
          };
          return {
            type: 'observation',
            result: result.data,
            success: true,
            timestamp: Date.now(),
          };
        } else {
          return {
            type: 'observation',
            result: {
              error:
                recoveryResult.error?.message ||
                'Tool execution failed after retries',
              attempts: recoveryResult.attempts,
            },
            success: false,
            timestamp: Date.now(),
          };
        }
      }

      // No error recovery configured, execute directly
      const result = await tool.execute(toolCall.arguments, { signal });
      return {
        type: 'observation',
        result: result.success ? result.data : { error: result.error },
        success: result.success,
        timestamp: Date.now(),
      };
    } catch (error) {
      // Special handling for timeout errors
      if (error instanceof ToolTimeoutError) {
        return {
          type: 'observation',
          result: {
            error: `Tool "${toolCall.name}" timed out after ${error.timeoutMs}ms`,
            timedOut: true,
          },
          success: false,
          timestamp: Date.now(),
        };
      }
      return {
        type: 'observation',
        result: {
          error: error instanceof Error ? error.message : String(error),
        },
        success: false,
        timestamp: Date.now(),
      };
    }
  };
}
