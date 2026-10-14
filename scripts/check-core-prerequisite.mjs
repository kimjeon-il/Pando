import { loadNodeCore } from '../tools/load-node-core.mjs';

try {
  const core = await loadNodeCore();
  console.log(`Shared C++ core prerequisite passed: ABI ${core.coreAbiVersion}, source ${core.coreSourceSha256}`);
} catch (error) {
  console.error(`[${error.code}] ${error.message}`);
  console.error('Rebuild and package the shared core from the current checkout before running dependent tests.');
  process.exitCode = 1;
}
