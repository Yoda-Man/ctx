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
