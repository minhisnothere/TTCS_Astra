/**
 * Astra state directory management.
 *
 * Local mode (cloned repo): uses ./workspaces/
 * NPX mode: uses ~/.astra/workspaces/, ~/.astra/
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMode } from './mode.js';

const ASTRA_HOME = path.join(os.homedir(), '.astra');

export function getConfigFile(): string {
  return path.join(ASTRA_HOME, 'config.toml');
}

/** Whether the npx-mode credential file (`~/.astra/config.toml`) exists on disk. */
export function configFileExists(): boolean {
  return fs.existsSync(getConfigFile());
}

export function getWorkspacesDir(): string {
  return getMode() === 'local' ? path.resolve('workspaces') : path.join(ASTRA_HOME, 'workspaces');
}

/**
 * Initialize state directories.
 * Local mode: creates ./workspaces/
 * NPX mode: creates ~/.astra/workspaces/
 */
export function initHome(): void {
  if (getMode() === 'local') {
    fs.mkdirSync(path.resolve('workspaces'), { recursive: true });
  } else {
    fs.mkdirSync(path.join(ASTRA_HOME, 'workspaces'), { recursive: true });
  }
}
