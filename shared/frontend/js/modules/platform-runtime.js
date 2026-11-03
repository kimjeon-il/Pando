import { assertPlatformPorts } from './platform-ports.js';

let installedPlatform = null;

export function installRuntimePlatform(platform, { productMode = 'editor' } = {}) {
  const accepted = assertPlatformPorts(platform, { productMode });
  if (installedPlatform && installedPlatform !== accepted) throw new Error('Runtime platform ports are already installed.');
  installedPlatform = accepted;
  return accepted;
}
