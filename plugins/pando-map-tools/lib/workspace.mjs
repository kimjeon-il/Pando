import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// An installed plugin binds to the existing permanent workspace, never a copy
// of its dependencies, data cache or Python environment.
export const workspace = resolve(process.env.PANDO_MAP_WORKSPACE || fileURLToPath(new URL('../../../', import.meta.url)));
if (!existsSync(resolve(workspace, 'tools/load-node-core.mjs'))) throw new Error('Set --workspace to the existing Pando work/ui checkout.');
export const workspaceModule = path => import(pathToFileURL(resolve(workspace, path)).href);
export const requireWorkspace = createRequire(resolve(workspace, 'package.json'));
export const { sharedCalculationCore: core } = await workspaceModule('assets/js/modules/temporal.js');
export const calculate = (operation, input) => JSON.parse(core.referenceImageCalculate(operation, JSON.stringify(input, (_k,v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)));
