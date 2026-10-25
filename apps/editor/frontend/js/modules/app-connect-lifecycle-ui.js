import { LIFECYCLE_UI_OWNER_PORTS } from './app-capability-ports-lifecycle-ui.js';
import { connectCapabilityOwners } from './app-capability-port-utils.js';

/** Explicit capability wiring; no state ownership or event registration. */
export function connectLifecycleUi({
  ports,
  fileBindings,
  globalInputBindings,
  editorBindings,
  progressiveStartup,
  domainAssembly,
  lifecycleAssembly,
}) {
  connectCapabilityOwners(LIFECYCLE_UI_OWNER_PORTS, {
    fileBindings,
    globalInputBindings,
    editorBindings,
    progressiveStartup,
    domainAssembly,
    lifecycleAssembly,
  }, ports);
}
