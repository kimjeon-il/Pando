// Adapt the browser asset-loading port for Node Worker fixtures. The actual
// compiled engine and production manifest verifier are shared with preflight.
export { loadNodeCore as loadVerifiedCore } from '../../tools/load-node-core.mjs';
