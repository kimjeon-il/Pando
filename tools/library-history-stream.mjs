// Transform only fast-export file commands; commit messages are byte streams.
import { Transform } from 'node:stream';

function decodePath(input) {
  if (!input.startsWith('"')) return input;
  if (!input.endsWith('"')) throw Error('Invalid quoted Git path');
  const bytes = [];
  for (let i = 1; i < input.length - 1; i++) {
    let code = input.charCodeAt(i);
    if (code === 92) {
      const escaped = input[++i];
      if (/[0-7]/.test(escaped || '')) {
        const octal = input.slice(i, i + 3);
        if (!/^[0-7]{3}$/.test(octal)) throw Error('Invalid Git path escape');
        code = parseInt(octal, 8); i += 2;
      } else {
        const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12, v: 11, a: 7, '\\': 92, '"': 34 };
        if (!Object.hasOwn(escapes, escaped)) throw Error('Invalid Git path escape');
        code = escapes[escaped];
      }
    }
    if (code > 255) throw Error('Invalid Git path bytes');
    bytes.push(code);
  }
  const buffer = Buffer.from(bytes), value = buffer.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(buffer)) throw Error('Non-UTF-8 Git paths are unsupported');
  return value;
}

function encodePath(path) {
  const bytes = Buffer.from(path, 'utf8');
  if ([...bytes].every(byte => byte >= 33 && byte <= 126 && byte !== 34 && byte !== 92)) return path;
  return '"' + [...bytes].map(byte => byte >= 32 && byte <= 126 && byte !== 34 && byte !== 92
    ? String.fromCharCode(byte) : byte === 34 ? '\\"' : byte === 92 ? '\\\\' : '\\' + byte.toString(8).padStart(3, '0')).join('') + '"';
}

export class HistoryStreamFilter extends Transform {
  constructor(manifest, indexBlobMap, renamePaths) {
    super();
    this.manifest = manifest;
    this.excluded = new Set(manifest.paths || []);
    this.excludedPrefixes = manifest.excludedPrefixes || [];
    this.retained = manifest.keepPaths ? new Set(manifest.keepPaths) : null;
    this.indexBlobMap = indexBlobMap;
    this.renamePaths = renamePaths;
    this.pending = Buffer.alloc(0);
    this.dataRemaining = 0;
    this.commits = [];
    this.commit = null;
  }
  transformLine(line) {
    if (line.startsWith('commit ')) this.commit = {};
    else if (line.startsWith('tag ') || line.startsWith('reset ')) this.commit = null;
    if (this.commit && line.startsWith('mark :')) this.commit.mark = line.slice(6);
    if (line.startsWith('original-oid ')) {
      if (this.commit) {
        if (!this.commit.mark) throw Error('Missing fast-export commit mark');
        this.commits.push({ mark: this.commit.mark, oid: line.slice(13) });
      }
      return null;
    }
    if (line.startsWith('data ')) {
      const match = /^data (\d+)$/.exec(line);
      if (!match || !Number.isSafeInteger(Number(match[1]))) throw Error('Unsupported fast-export data');
      this.dataRemaining = Number(match[1]);
    }
    if (!this.commit || !/^[MD] /.test(line)) return line;
    const match = /^(M ([0-7]+) (\S+) |D )(.*)$/.exec(line);
    if (!match) throw Error('Unsupported fast-export file command');
    const path = decodePath(match[4]);
    if (this.excluded.has(path) || this.excludedPrefixes.some(prefix => path.startsWith(prefix)) || (this.retained && !this.retained.has(path))) return null;
    const newPath = encodePath(this.renamePaths[path] || path);
    if (line[0] === 'D') return 'D ' + newPath;
    const blob = match[3], allowed = this.manifest.allowedBlobIds?.[path];
    if (allowed && !allowed.includes(blob)) return 'D ' + newPath;
    return `M ${match[2]} ${path === 'archive/index.json' ? this.indexBlobMap[blob] || blob : blob} ${newPath}`;
  }
  _transform(chunk, encoding, callback) {
    try {
      this.pending = Buffer.concat([this.pending, chunk]);
      while (this.pending.length) {
        if (this.dataRemaining) {
          const count = Math.min(this.dataRemaining, this.pending.length);
          this.push(this.pending.subarray(0, count)); this.pending = this.pending.subarray(count);
          this.dataRemaining -= count; continue;
        }
        const end = this.pending.indexOf(10);
        if (end < 0) {
          if (this.pending.length > 1024 * 1024) throw Error('Fast-export command exceeds byte limit');
          break;
        }
        const line = this.pending.subarray(0, end).toString('utf8');
        this.pending = this.pending.subarray(end + 1);
        const transformed = this.transformLine(line);
        if (transformed !== null) this.push(Buffer.from(transformed + '\n'));
      }
      callback();
    } catch (error) { callback(error); }
  }
  _flush(callback) {
    callback(this.pending.length || this.dataRemaining ? Error('Truncated fast-export stream') : null);
  }
}
