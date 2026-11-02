export const FILE_ACCESS_REQUIRED_METHODS = Object.freeze({
  viewer: Object.freeze(['openProjectFile']),
  editor: Object.freeze(['openProjectFile', 'openGisFiles', 'prepareProjectSave', 'saveExportFile']),
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
  if (!required) throw new TypeError('File access validation requires viewer or editor product mode.');
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

export function assertGisFileSelection(selection) {
  requireRecord(selection, 'GIS file selection');
  if (typeof selection.cancelled !== 'boolean') throw new TypeError('GIS file selection requires cancelled.');
  if (selection.cancelled) return selection;
  if (!Array.isArray(selection.files) || !selection.files.length) throw new TypeError('GIS file selection requires files.');
  for (const file of selection.files) namedBlob(file, 'GIS file selection entry');
  return selection;
}

export function assertProjectSaveDestination(destination) {
  requireRecord(destination, 'Project save destination');
  for (const name of ['write', 'abort']) {
    if (typeof destination[name] !== 'function') throw new TypeError(`Project save destination requires ${name}.`);
  }
  return destination;
}

export function assertFileWriteReceipt(receipt) {
  requireRecord(receipt, 'File write receipt');
  if (typeof receipt.downloaded !== 'boolean') throw new TypeError('File write receipt requires downloaded.');
  if (receipt.path !== undefined && (typeof receipt.path !== 'string' || !receipt.path)) {
    throw new TypeError('File write receipt path must be a non-empty string when provided.');
  }
  return receipt;
}
