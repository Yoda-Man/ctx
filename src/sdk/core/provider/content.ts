/**
 * Content utilities for multimodal message handling
 * @module
 */

import type {
  ContentPart,
  MessageContent,
  TextContentPart,
  ImageContentPart,
  DocumentContentPart,
} from './types';

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if message content is multimodal (array of content parts)
 */
export function isMultimodalContent(
  content: MessageContent
): content is ContentPart[] {
  return Array.isArray(content);
}

/**
 * Check if a content part is text
 */
export function isTextContent(part: ContentPart): part is TextContentPart {
  return part.type === 'text';
}

/**
 * Check if a content part is an image
 */
export function isImageContent(part: ContentPart): part is ImageContentPart {
  return part.type === 'image';
}

/**
 * Check if a content part is a document
 */
export function isDocumentContent(
  part: ContentPart
): part is DocumentContentPart {
  return part.type === 'document';
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize message content to always be an array of content parts.
 * Useful for providers that need consistent array format.
 *
 * @example
 * ```typescript
 * normalizeContent("Hello") // [{ type: 'text', text: 'Hello' }]
 * normalizeContent([{ type: 'text', text: 'Hi' }]) // [{ type: 'text', text: 'Hi' }]
 * ```
 */
export function normalizeContent(content: MessageContent): ContentPart[] {
  if (isMultimodalContent(content)) {
    return content;
  }
  return [{ type: 'text', text: content }];
}

/**
 * Extract all text from message content.
 * Concatenates text from string content or all text parts.
 *
 * @example
 * ```typescript
 * extractTextContent("Hello") // "Hello"
 * extractTextContent([
 *   { type: 'text', text: 'Hello ' },
 *   { type: 'image', url: '...' },
 *   { type: 'text', text: 'World' }
 * ]) // "Hello World"
 * ```
 */
export function extractTextContent(content: MessageContent): string {
  if (!isMultimodalContent(content)) {
    return content;
  }

  return content
    .filter(isTextContent)
    .map((part) => part.text)
    .join('');
}
