export const DOCUMENT_TRANSFER_PROTOCOL_VERSION = 1;

export const DOCUMENT_TRANSFER_LIMITS = Object.freeze({
  chunkBytes: 256 * 1024,
  maxDocumentBytes: 256 * 1024 * 1024,
  maxGisFiles: 16,
});

export const DOCUMENT_TRANSFER_COMMANDS = Object.freeze({
  beginWrite: 'begin_document_write',
  appendWrite: 'append_document_chunk',
  finishWrite: 'finish_document_write',
  beginRead: 'begin_document_read',
  readChunk: 'read_document_chunk',
  abort: 'abort_document_transfer',
});

export const DOCUMENT_TRANSFER_KINDS = Object.freeze({
  write: Object.freeze({
    project: 'project',
    gisGeoPackage: 'gis-gpkg',
    gisZip: 'gis-zip',
  }),
  read: Object.freeze({
    project: 'project',
    gis: 'gis',
  }),
});

export const DOCUMENT_TRANSFER_EXPORT_KIND_BY_FILENAME = Object.freeze({
  '판도연구소-GIS-데이터.gpkg': DOCUMENT_TRANSFER_KINDS.write.gisGeoPackage,
  '판도연구소-GIS-데이터.zip': DOCUMENT_TRANSFER_KINDS.write.gisZip,
});
