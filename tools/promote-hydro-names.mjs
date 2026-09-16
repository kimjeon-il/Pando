#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  approvedSystemsFromReview,
  promoteCoreMetadata,
  promoteManifest,
} from './lib/promote-hydro-names.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hydroRoot = path.join(root, 'assets', 'data', 'hydro');
const sourceDirectory = path.join(hydroRoot, 'v0.13.0');
const targetDirectory = path.join(hydroRoot, 'v0.13.1');
const review = readJson(path.join(root, 'reports', 'hydro-names', 'europe-major-rivers.json'));
const overridePath = path.join(hydroRoot, 'hydronym-ko-overrides.json');
const overrideDocument = readJson(overridePath);
const systems = approvedSystemsFromReview(review);

const nextOverrides = { ...overrideDocument, version: '0.13.1', systems };
fs.writeFileSync(overridePath, `${JSON.stringify(nextOverrides, null, 2)}\n`);

const sourceCore = JSON.parse(gunzipSync(fs.readFileSync(path.join(sourceDirectory, 'metadata-core.json.gz'))));
const promotedCore = promoteCoreMetadata(sourceCore, systems);
const encodedCore = gzipSync(Buffer.from(`${JSON.stringify(promotedCore)}\n`), { level: 9, mtime: 0 });
fs.mkdirSync(targetDirectory, { recursive: true });
const corePath = path.join(targetDirectory, 'metadata-core.json.gz');
fs.writeFileSync(corePath, encodedCore);
const coreFile = { bytes: encodedCore.byteLength, sha256: sha256(encodedCore) };

const sourceManifest = readJson(path.join(sourceDirectory, 'manifest.json'));
const manifest = promoteManifest(sourceManifest, coreFile);
manifest.sources = {
  ...manifest.sources,
  hydronymOverrides: {
    file: 'hydronym-ko-overrides.json',
    sha256: sha256(fs.readFileSync(overridePath)),
  },
  nameEnrichment: {
    ...manifest.sources?.nameEnrichment,
    namedRiverSystems: Number(manifest.sources?.nameEnrichment?.namedRiverSystems || 0) + Object.keys(systems).length,
    unnamedRiverSystems: Number(manifest.sources?.nameEnrichment?.unnamedRiverSystems || 0) - Object.keys(systems).length,
  },
};
manifest.stats.namedRiverSystemCount = Number(manifest.stats.namedRiverSystemCount || 0) + Object.keys(systems).length;
manifest.stats.unnamedRiverSystemCount = Number(manifest.stats.unnamedRiverSystemCount || 0) - Object.keys(systems).length;
fs.writeFileSync(path.join(targetDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Promoted ${Object.keys(systems).length} reviewed river names to v0.13.1`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
