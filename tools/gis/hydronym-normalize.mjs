import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Python's Unicode whitespace includes NEL and the ASCII information separators.
const whitespace = '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const spaces = new RegExp(`${whitespace}+`, 'gu');
const absoluteEnd = '(?![\\s\\S])';
const pythonEnd = `(?=\\n?${absoluteEnd})`;
const trim = (value) => value.replace(new RegExp(`^${whitespace}+|${whitespace}+${absoluteEnd}`, 'gu'), '');
const koreanSuffix = new RegExp(`${whitespace}+(호수|강|천|호)${pythonEnd}`, 'u');
const duplicateSuffix = new RegExp(`(호수|강|천|호)\\1${pythonEnd}`, 'u');
const lastKorean = new RegExp(`[가-힣]${pythonEnd}`, 'u');
// Python IGNORECASE includes Turkish dotted/dotless I, Kelvin sign and long s.
const englishSuffix = new RegExp(`${whitespace}+(r[iİı]ver|stream|creek|lake|reservo[iİı]r)${pythonEnd}`, 'iu');

export function normalizeHydronym(name, category, overrides) {
  if (typeof name !== 'string' || typeof category !== 'string' || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('name and category must be strings and overrides must be an object');
  }
  let value = trim(name.replace(spaces, ' '));
  if (!value) return '';
  const lookup = (key) => Object.hasOwn(overrides, key) ? overrides[key] : key;
  value = lookup(value);
  if (typeof value !== 'string') throw new TypeError('hydronym alias must be a string');
  value = value.replace(koreanSuffix, '$1').replace(duplicateSuffix, '$1');
  if (/[A-Za-z]/u.test(value)) value = trim(value.replace(englishSuffix, ''));
  value = lookup(value);
  if (typeof value !== 'string') throw new TypeError('hydronym alias must be a string');
  if (/[가-힣]/u.test(value) && !value.startsWith('미명명')) value = value.replace(spaces, '');
  if (category === 'river' && lastKorean.test(value) && !['강', '천', '수계'].some((suffix) => value.endsWith(suffix))) value += '강';
  if (category === 'lake' && lastKorean.test(value) && !['호', '호수', '해', '만', '저수지'].some((suffix) => value.endsWith(suffix))) value += '호';
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--stream') {
    process.stderr.write('Usage: node hydronym-normalize.mjs --stream\n');
    process.exitCode = 2;
  } else {
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      try {
        const { name, category, overrides } = JSON.parse(line);
        process.stdout.write(`${JSON.stringify({ value: normalizeHydronym(name, category, overrides) })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ error: String(error.message) })}\n`);
      }
    }
  }
}
