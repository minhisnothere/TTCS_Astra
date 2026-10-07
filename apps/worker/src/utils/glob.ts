import { glob } from 'zx';

/**
 * Whether a code_path rule value contains wildcard syntax (e.g. `*`, `**`, `{a,b}`) rather
 * than naming a single literal path. Used to tag rules as `[GLOB]` vs `[FILE]` when rendering
 * them into agent prompts and permission-system deny config, since the two need different
 * matching behavior downstream.
 */
export function isGlobPattern(value: string): boolean {
  return glob.isDynamicPattern(value);
}
