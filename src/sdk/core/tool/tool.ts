import { z } from 'zod';
import type { Tool, ToolConfig, ToolExecuteContext, ToolResult } from './types';
import {
  ToolError,
  ValidationError,
  ToolTimeoutError,
  ToolOutputValidationError,
} from '../errors/errors';
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  withTimeout,
  createCombinedSignal,
} from './timeout';

/**
 * Define a type-safe tool with Zod validation
 *
 * @example
 * ```typescript
 * const searchTool = defineTool({
 *   name: 'search',
 *   description: 'Search for information',
 *   parameters: z.object({
 *     query: z.string().describe('Search query'),
 *     limit: z.number().optional().default(10),
 *   }),
 *   execute: async ({ query, limit }) => {
 *     const results = await search(query, limit);
 *     return { success: true, data: results };
 *   },
 * });
 * ```
 */
export function defineTool<TInput extends z.ZodType, TOutput = unknown>(
  config: ToolConfig<TInput, TOutput>
): Tool<TInput, TOutput> {
  const {
    name,
    description,
    parameters,
    execute,
    timeout: configTimeout,
    outputSchema,
  } = config;

  return {
    name,
    description,
    parameters,

    async execute(
      input: z.infer<TInput>,
      context: ToolExecuteContext = {}
    ): Promise<ToolResult<TOutput>> {
      // Validate input
      const validation = parameters.safeParse(input);
      if (!validation.success) {
        throw new ValidationError(
          `Tool "${name}" input validation failed`,
          validation.error.issues
        );
      }

      // Determine effective timeout: runtime > config > default
      const effectiveTimeout =
        context.timeout ?? configTimeout ?? DEFAULT_TOOL_TIMEOUT_MS;

      // Create combined signal (timeout + external abort)
      const { signal, cleanup } = createCombinedSignal(
        effectiveTimeout,
        context.signal
      );

      try {
        // Execute with timeout enforcement
        const result = await withTimeout(
          execute(validation.data, { ...context, signal }),
          effectiveTimeout,
          name
        );
        // Validate output if schema provided
        if (outputSchema && result.success && result.data !== undefined) {
          const outputValidation = outputSchema.safeParse(result.data);
          if (!outputValidation.success) {
            throw new ToolOutputValidationError(
              name,
              outputValidation.error.issues.map((issue) => ({
                path: issue.path.join('.') || 'root',
                message: issue.message,
              }))
            );
          }
        }
        return result;
      } catch (error) {
        // Re-throw timeout and output validation errors as-is
        if (
          error instanceof ToolTimeoutError ||
          error instanceof ToolOutputValidationError
        ) {
          throw error;
        }
        throw new ToolError(
          `Tool "${name}" execution failed: ${error instanceof Error ? error.message : String(error)}`,
          name,
          error instanceof Error ? error : new Error(String(error))
        );
      } finally {
        // Always cleanup to prevent memory leaks
        cleanup();
      }
    },

    validate(input: unknown) {
      return parameters.safeParse(input);
    },

    toJSON() {
      return {
        name,
        description,
        // zod 4 converts to JSON Schema itself; the hand-written converter read
        // zod 3 internals. $schema is dropped: providers want the bare schema.
        parameters: (({ $schema: _schema, ...schema }) => schema)(z.toJSONSchema(parameters)),
      };
    },
  };
}
