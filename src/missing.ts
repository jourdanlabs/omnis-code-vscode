/**
 * Honest copy for a missing binary. One string per named tool, reused by the
 * engine adapters, the panels, and the tests — so a setting rename cannot
 * silently rot in one place.
 *
 * A missing binary is a successful report, not a spinner and not a green
 * default. These strings name the binary and the setting that locates it.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const MISSING_OMNIS_KEY =
  'omnis-key not found. Set "omnisCode.enginePath" to its full path (VS Code launched from the Dock or Finder on macOS does not inherit your shell PATH).';

export const MISSING_OMNIS_CODE =
  'omnis-code not found. It is resolved beside omnis-key. Set "omnisCode.enginePath" to the omnis-key binary.';

export const MISSING_CRUCIBLE =
  'crucible-scan not found. It is resolved beside omnis-key. Set "omnisCode.enginePath" to the omnis-key binary.';

export const MISSING_MTS =
  'mts not found. Set "omnisCode.mtsPath" to the MAP THE SOUL CLI (VS Code launched from the Dock or Finder on macOS does not inherit your shell PATH).';

export const MISSING_CAIRN =
  'cairn not found. Set "omnisCode.cairnServerScript" to CAIRN\'s MCP server entry (default probe: ~/projects/cairn/mcp/server.mjs).';

/** CAIRN's MCP entry point, if it is installed where we can see it. */
export function resolveCairnScript(configured?: string, home = homedir()): string | null {
  const candidate =
    configured?.trim() || join(home, 'projects', 'cairn', 'mcp', 'server.mjs');
  return existsSync(candidate) ? candidate : null;
}
