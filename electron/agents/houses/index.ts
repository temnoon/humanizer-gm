/**
 * House Agents Module
 *
 * The specialized agents of the Council.
 */

// Model Master - AI Control wrapper
export { ModelMasterAgent, getModelMasterAgent } from './model-master';

// Curator - Content quality assessment
export { CuratorAgent, getCuratorAgent } from './curator';

// Harvester - Archive search and extraction
export { HarvesterAgent, getHarvesterAgent } from './harvester';

// Builder - Chapter composition
export { BuilderAgent, getBuilderAgent } from './builder';

// Reviewer - Quality checks and signoffs
export { ReviewerAgent, getReviewerAgent } from './reviewer';

// Project Manager - Project lifecycle
export { ProjectManagerAgent, getProjectManagerAgent } from './project-manager';

// Explorer - Format discovery and import intelligence
export { ExplorerAgent, getExplorerAgent } from './explorer';
export type {
  StructureInsight,
  DetectedPattern,
  FormatHypothesis,
  ProbeSample,
  UserQuery,
  LearnedFormat,
  DiscoverySession,
} from './explorer';
