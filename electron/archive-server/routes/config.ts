/**
 * Config Routes - Archive Server Configuration API
 *
 * Endpoints:
 * GET  /api/config                 - Get all configuration
 * GET  /api/config/:section        - Get specific section
 * PUT  /api/config/:section        - Update specific section
 * POST /api/config/reset           - Reset all to defaults
 * POST /api/config/reset/:section  - Reset specific section to defaults
 */

import { Router, Request, Response } from 'express';
import {
  configService,
  type ArchiveServerConfig,
} from '../services/ConfigService';

// Valid section names
const VALID_SECTIONS: (keyof ArchiveServerConfig)[] = [
  'harvest',
  'cache',
  'retrieval',
  'rateLimit',
  'pyramid',
  'embeddings',
];

function isValidSection(section: string): section is keyof ArchiveServerConfig {
  return VALID_SECTIONS.includes(section as keyof ArchiveServerConfig);
}

export function createConfigRouter(): Router {
  const router = Router();

  /**
   * GET /api/config
   * Get all configuration
   */
  router.get('/', async (_req: Request, res: Response) => {
    try {
      await configService.init();
      const config = configService.getAll();
      res.json(config);
    } catch (error) {
      console.error('[config] Failed to get config:', error);
      res.status(500).json({
        error: 'Failed to get configuration',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/config/:section
   * Get specific configuration section
   */
  router.get('/:section', async (req: Request, res: Response) => {
    try {
      const { section } = req.params;

      if (!isValidSection(section)) {
        return res.status(400).json({
          error: `Invalid section: ${section}`,
          validSections: VALID_SECTIONS,
        });
      }

      await configService.init();
      const sectionConfig = configService.getSection(section);
      res.json(sectionConfig);
    } catch (error) {
      console.error('[config] Failed to get section:', error);
      res.status(500).json({
        error: 'Failed to get configuration section',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * PUT /api/config/:section
   * Update specific configuration section
   */
  router.put('/:section', async (req: Request, res: Response) => {
    try {
      const { section } = req.params;
      const values = req.body;

      if (!isValidSection(section)) {
        return res.status(400).json({
          error: `Invalid section: ${section}`,
          validSections: VALID_SECTIONS,
        });
      }

      if (!values || typeof values !== 'object') {
        return res.status(400).json({
          error: 'Request body must be an object with configuration values',
        });
      }

      await configService.init();
      const updated = await configService.updateSection(section, values);

      res.json({
        section,
        config: updated,
        message: 'Configuration updated successfully',
      });
    } catch (error) {
      console.error('[config] Failed to update section:', error);
      res.status(500).json({
        error: 'Failed to update configuration',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/config/reset
   * Reset all configuration to defaults
   */
  router.post('/reset', async (_req: Request, res: Response) => {
    try {
      await configService.init();
      const config = await configService.reset();

      res.json({
        config,
        message: 'Configuration reset to defaults',
      });
    } catch (error) {
      console.error('[config] Failed to reset config:', error);
      res.status(500).json({
        error: 'Failed to reset configuration',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/config/reset/:section
   * Reset specific section to defaults
   */
  router.post('/reset/:section', async (req: Request, res: Response) => {
    try {
      const { section } = req.params;

      if (!isValidSection(section)) {
        return res.status(400).json({
          error: `Invalid section: ${section}`,
          validSections: VALID_SECTIONS,
        });
      }

      await configService.init();
      const sectionConfig = await configService.resetSection(section);

      res.json({
        section,
        config: sectionConfig,
        message: `Section "${section}" reset to defaults`,
      });
    } catch (error) {
      console.error('[config] Failed to reset section:', error);
      res.status(500).json({
        error: 'Failed to reset configuration section',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
