/**
 * Agents that drive a live browser via the playwright-cli skill. These get the
 * skill registered through pi's `skillsOverride`.
 *
 * `validate-authentication` is not an AgentName in the main pipeline graph but
 * runs the same executor, so it is included by string.
 */
export const BROWSER_AGENTS: ReadonlySet<string> = new Set([
  'recon',
  'injection-exploit', 
  'validate-authentication',
  'verify-exploit',
]);

/** Whether the given agent uses the browser (and therefore needs the playwright-cli skill under pi). */
export function isBrowserAgent(agentName: string | null | undefined): boolean {
  return agentName != null && BROWSER_AGENTS.has(agentName);
}
