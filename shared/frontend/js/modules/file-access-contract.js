export const FILE_ACCESS_REQUIRED_METHODS = Object.freeze({
  viewer: Object.freeze(['openProjectFile']),
});

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}
function namedBlob(value, label) {
  if (!(value instanceof Blob) || typeof value.name !== 'string' || !value.name.trim()) {
    throw new TypeError(`${label} must be a named File.`);
  }
  return value;
}

export function assertFileAccessPort(fileAccess, { productMode } = {}) {
  requireRecord(fileAccess, 'File access port');
  const required = FILE_ACCESS_REQUIRED_METHODS[productMode];
  if (!required) throw new TypeError('File access validation requires viewer product mode.');
  for (const name of required) {
    if (typeof fileAccess[name] !== 'function') throw new TypeError(`File access requires ${name}.`);
  }
  for (const name of ['bind', 'dispose']) {
    if (fileAccess[name] !== undefined && typeof fileAccess[name] !== 'function') {
      throw new TypeError(`Optional file access ${name} must be a function.`);
    }
  }
  return fileAccess;
}

export function assertProjectFileSelection(selection) {
  requireRecord(selection, 'Project file selection');
  if (typeof selection.cancelled !== 'boolean') throw new TypeError('Project file selection requires cancelled.');
  if (selection.cancelled) return selection;
  namedBlob(selection.file, 'Project file selection file');
  return selection;
}
