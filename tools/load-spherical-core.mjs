// Node entrypoint for classic geometry modules that use the shared C++ core.
import { loadNodeCore } from './load-node-core.mjs';

const core = await loadNodeCore();
globalThis.PandoLabSphericalCore = core;
export { core as sphericalCore };
