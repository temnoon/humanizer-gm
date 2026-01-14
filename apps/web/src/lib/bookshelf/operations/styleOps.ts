/**
 * Style Operations
 *
 * CRUD operations for styles with Xanadu/localStorage support.
 * Extracted from BookshelfContext for modularization.
 */

import type { EntityURI, Style } from '../types';
import { generateURI } from '../types';
import { bookshelfService } from '../BookshelfService';
import { isXanaduAvailable, isDevFallbackEnabled, assertStorageAvailable } from './storage';

/**
 * Get a style by URI
 */
export function getStyle(
  uri: EntityURI,
  styles: Style[]
): Style | undefined {
  if (isXanaduAvailable()) {
    return styles.find(s => s.uri === uri);
  } else if (isDevFallbackEnabled()) {
    return bookshelfService.getStyle(uri);
  }
  return undefined;
}

/**
 * Create a new style
 */
export async function createStyle(
  style: Omit<Style, 'uri' | 'type'>,
  setStyles: (styles: Style[]) => void
): Promise<Style> {
  assertStorageAvailable();

  const uri = generateURI('style', style.author || 'user', style.name);
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const full: Style = {
    ...style,
    type: 'style',
    uri,
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (isXanaduAvailable()) {
    await window.electronAPI!.xanadu.styles.upsert({
      id,
      uri,
      name: style.name,
      description: style.description,
      author: style.author,
      characteristics: style.characteristics,
      structure: style.structure,
      stylePrompt: style.stylePrompt,
      derivedFrom: style.derivedFrom,
      tags: style.tags,
    });
    const xStyles = await window.electronAPI!.xanadu.styles.list(true);
    setStyles(xStyles as unknown as Style[]);
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for createStyle');
    bookshelfService.createStyle(style);
    setStyles(bookshelfService.getAllStyles());
  }

  return full;
}
