/**
 * Facebook Router - Modular route combiner
 *
 * Combines all Facebook route modules into a single router.
 * Original monolithic file: 2,932 lines → 7 modules + index
 *
 * Route Modules:
 * - feed.routes.ts: /periods, /notes/*
 * - media.routes.ts: /media*, /image, /serve-media, /video*, /content/:id/media, /transcription/*
 * - social.routes.ts: /graph/*, /friends/*
 * - groups.routes.ts: /groups/*
 * - messenger.routes.ts: /messenger/*
 * - meta.routes.ts: /advertisers/*, /pages/*, /reactions/*
 */

import { Router } from 'express';
import { createFeedRouter } from './feed.routes';
import { createMediaRouter } from './media.routes';
import { createSocialRouter } from './social.routes';
import { createGroupsRouter } from './groups.routes';
import { createMessengerRouter } from './messenger.routes';
import { createMetaRouter } from './meta.routes';

export function createFacebookRouter(): Router {
  const router = Router();

  // Mount each route module
  // All routes are relative to /api/facebook (or just / if mounted at /api/facebook)

  // Feed routes: /periods, /notes/*
  router.use('/', createFeedRouter());

  // Media routes: /media*, /image, /serve-media, /video*, /content/:id/media, /transcription/*
  router.use('/', createMediaRouter());

  // Social routes: /graph/*, /friends/*
  router.use('/', createSocialRouter());

  // Groups routes: /groups/*
  router.use('/', createGroupsRouter());

  // Messenger routes: /messenger/*
  router.use('/', createMessengerRouter());

  // Meta routes: /advertisers/*, /pages/*, /reactions/*
  router.use('/', createMetaRouter());

  return router;
}

// Re-export individual routers for testing or selective mounting
export { createFeedRouter } from './feed.routes';
export { createMediaRouter } from './media.routes';
export { createSocialRouter } from './social.routes';
export { createGroupsRouter } from './groups.routes';
export { createMessengerRouter } from './messenger.routes';
export { createMetaRouter } from './meta.routes';
