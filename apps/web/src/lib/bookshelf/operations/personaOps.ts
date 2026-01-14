/**
 * Persona Operations
 *
 * CRUD operations for personas with Xanadu/localStorage support.
 * Extracted from BookshelfContext for modularization.
 */

import type { EntityURI, Persona } from '../types';
import { generateURI } from '../types';
import { bookshelfService } from '../BookshelfService';
import { isXanaduAvailable, isDevFallbackEnabled, assertStorageAvailable } from './storage';

/**
 * Get a persona by URI
 */
export function getPersona(
  uri: EntityURI,
  personas: Persona[]
): Persona | undefined {
  if (isXanaduAvailable()) {
    return personas.find(p => p.uri === uri);
  } else if (isDevFallbackEnabled()) {
    return bookshelfService.getPersona(uri);
  }
  return undefined;
}

/**
 * Create a new persona
 */
export async function createPersona(
  persona: Omit<Persona, 'uri' | 'type'>,
  setPersonas: (personas: Persona[]) => void
): Promise<Persona> {
  assertStorageAvailable();

  const uri = generateURI('persona', persona.author || 'user', persona.name);
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const full: Persona = {
    ...persona,
    type: 'persona',
    uri,
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (isXanaduAvailable()) {
    await window.electronAPI!.xanadu.personas.upsert({
      id,
      uri,
      name: persona.name,
      description: persona.description,
      author: persona.author,
      voice: persona.voice,
      vocabulary: persona.vocabulary,
      derivedFrom: persona.derivedFrom,
      influences: persona.influences,
      exemplars: persona.exemplars,
      systemPrompt: persona.systemPrompt,
      tags: persona.tags,
    });
    const xPersonas = await window.electronAPI!.xanadu.personas.list(true);
    setPersonas(xPersonas as unknown as Persona[]);
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for createPersona');
    bookshelfService.createPersona(persona);
    setPersonas(bookshelfService.getAllPersonas());
  }

  return full;
}
