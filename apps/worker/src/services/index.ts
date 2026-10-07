/**
 * Services Module
 *
 * Exports DI container and service classes for Astra agent execution.
 * Services are pure domain logic with no Temporal dependencies.
 */

export type { PiPromptResult } from '../ai/pi/pi-executor.js';
export { runPiPrompt } from '../ai/pi/pi-executor.js';
export type { AgentExecutionInput } from './agent-execution.js';
export { AgentExecutionService } from './agent-execution.js';
export { ConfigLoaderService } from './config-loader.js';
export type { ContainerDependencies } from './container.js';
export { Container, getContainer, getOrCreateContainer, removeContainer, setContainerFactory } from './container.js';
export { ExploitationCheckerService } from './exploitation-checker.js';
export type { CommittedReadResult } from './git-manager.js';
export {
  blobShaFromHead,
  classifyHeadReadFailure,
  commitExactPaths,
  getGitCommitHash,
  isAncestor,
  parsePorcelainZ,
  pathsChangedInCommit,
  readCommittedFile,
  readFileFromHead,
  restorePathsFromHead,
  rollbackGitWorkspace,
  withGitRepoLock,
} from './git-manager.js';
export { loadPrompt } from './prompt-manager.js';
export type { ReportData, ReportMeta } from './report-renderer.js';
export { renderReport } from './report-renderer.js';
export { assembleFinalReport, copyReportToRunRoot } from './reporting.js';
