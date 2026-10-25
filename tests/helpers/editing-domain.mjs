import { createEditingDomain } from "../../apps/editor/frontend/js/modules/editing-domain.js";
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateWebFlagDataUrl } from "../../shared/frontend/js/modules/country-flags.js";

const modulePath=resolve(process.env.PANDOEDITOR_WASM_MODULE || fileURLToPath(new URL("../../shared/frontend/static/wasm/pandoeditor-core.js",import.meta.url)));
const { default: createCore }=await import(pathToFileURL(modulePath));
const core=await createCore({ wasmBinary: await readFile(modulePath.replace(/\.js$/,'.wasm')) });
if (core.coreAbiVersion!==1 || core.coreCompilerVersion!=='4.0.20' || !/^[a-f0-9]{64}$/.test(core.coreSourceSha256))
  throw new Error('The required actual draft Core ABI is unavailable.');
const seed=JSON.parse(await readFile(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));

// Headless platform adapter. Tests that inspect scheduling supply their own pair.
export function createTestEditingDomain(options = {}) {
  const session=new core.DocumentSession({ validateFlagDataUrl: validateWebFlagDataUrl }),subscribers=new Set();
  session.documentLoad(JSON.stringify(seed),'2026-10');
  const initialConfig=options.draftServices?.getToolConfig?.('select');
  if (initialConfig) session.draftApply({ action: 'start',expectedEpoch: session.projectState().epoch,
    shape: initialConfig.shape,coords: [],inputPhase: 'draw' });
  const commandOwner={
    state: () => session.projectState(),
    subscribeTransitions(listener) { subscribers.add(listener);return () => subscribers.delete(listener); },
    async draftApply(payload) {
      const result=session.draftApply({ expectedEpoch: session.projectState().epoch,...payload });
      for (const listener of subscribers) listener(result,'core.document-draft-apply');
      return result;
    },
  };
  const domain=createEditingDomain({
    ...options,
    commandOwner,
    geometryEditing: {boundaryDraftActive:()=>false,...options.geometryEditing},
    draftServices: {
      requestFrame: callback => setTimeout(callback, 0),
      cancelFrame: handle => clearTimeout(handle),
      reportOperationError: error => { throw error; },
      ...options.draftServices,
    },
  });
  domain.acceptCoreDraftSnapshot(session.draftSnapshot());
  return Object.freeze({ ...domain,dispose() { domain.dispose();session.delete(); } });
}
