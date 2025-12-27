/**
 * Profile Module
 *
 * NPE-API integration for persona/style extraction.
 * Populates the `extracted` fields on Persona and Style types.
 */

export {
  extractPersona,
  extractStyle,
  discoverVoices,
  extractBookProfile,
  toUnifiedPersona,
  toUnifiedStyle,
  toBookProfile,
} from './ProfileExtractionService';

export type {
  ExtractPersonaRequest,
  ExtractPersonaResponse,
  ExtractStyleRequest,
  ExtractStyleResponse,
  DiscoverVoicesRequest,
  DiscoverVoicesResponse,
  BookProfileExtractionResult,
  ExtractedThemes,
  ExtractedPersonaAttributes,
  ExtractedStyleAttributes,
  DiscoveredPersona,
  DiscoveredStyle,
} from './types';
