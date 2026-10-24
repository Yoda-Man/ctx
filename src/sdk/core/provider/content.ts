/**
 * Content utilities for multimodal message handling
 * @module
 */

import type {
  ContentPart,
  
  TextContentPart,
  ImageContentPart,
  
} from './types';

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
