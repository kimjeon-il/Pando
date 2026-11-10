import {execFileSync} from "node:child_process";
import {readFileSync} from 'node:fs';
import {isAbsolute,relative,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {defaultRoot,git,libraryConfig,libraryReportRoot,libraryReportEditRoot} from "./library-context.mjs";
import {centralizeLibraryReports} from "./library-reports.mjs";
import {prepareLibraryData,prepareLibraryMetadata,mountLibraryInputs,beginLibraryWrite,endLibraryWrite,withLibraryWrite} from "./library-runtime.mjs";
import {organizeLibraryReports,publishLibraryReports,checkLibraryReports} from "./library-report-publication.mjs";
import {storeLibraryData} from "./library-store.mjs";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--prepare-metadata') {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || defaultRoot;
    const { repository, revision } = prepareLibraryMetadata({ root });
    console.log(`Library metadata prepared: ${repository}@${revision}`);
  } else if (process.argv[2]?.startsWith('--mount-inputs=')) {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7);
    if (!root) throw Error('Explicit reproduction root is required');
    console.log(mountLibraryInputs({ source: process.argv[2].slice(15), root }));
  } else if (process.argv[2] === '--begin-write' || process.argv[2] === '--end-write' || process.argv[2] === '--with-write') {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || defaultRoot;
    if (process.argv[2] === '--end-write') endLibraryWrite({ root, id: process.argv.find(arg => arg.startsWith('--lease-id='))?.slice(11) });
    else {
      const prefixes = process.argv.filter(arg => arg.startsWith('--include-prefix=')).map(arg => arg.slice(17));
      if (process.argv[2] === '--begin-write') console.log(JSON.stringify(beginLibraryWrite({ root, prefixes, pid: Number(process.argv.find(arg => arg.startsWith('--writer-pid='))?.slice(13) || process.pid) })));
      else {
        const at = process.argv.indexOf('--'); if (at < 0 || at === process.argv.length - 1) throw Error('A scoped writer command is required');
        let status = 0;
        withLibraryWrite({ root, prefixes }, lease => { try { execFileSync(process.argv[at + 1], process.argv.slice(at + 2), { cwd: root, stdio: 'inherit', env: { ...process.env, PANDOLAB_LIBRARY_WRITE_LEASE: lease.id } }); } catch (error) { status = error.status || 1; } });
        process.exitCode = status;
      }
    }
  } else if (process.argv[2] === '--organize-reports') {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || defaultRoot;
    console.log(JSON.stringify(organizeLibraryReports({ root, apply: process.argv.includes('--apply') })));
  } else if (process.argv[2] === '--centralize-reports') {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || defaultRoot;
    console.log(JSON.stringify(centralizeLibraryReports({ root, apply: process.argv.includes('--apply') })));
  } else if (process.argv[2] === '--report-edit-root') {
    console.log(libraryReportEditRoot(process.argv[3] || defaultRoot));
  } else if (process.argv[2] === '--report-root') {
    console.log(libraryReportRoot(process.argv[3] || defaultRoot));
  } else {
  const prefixes = process.argv.filter(arg => arg.startsWith('--include-prefix=')).map(arg => arg.slice('--include-prefix='.length));
  if (process.argv.includes('--publish-reports') || process.argv.includes('--check-reports')) {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || defaultRoot;
    const operation = process.argv.includes('--publish-reports') ? publishLibraryReports : checkLibraryReports;
    const removePaths = process.argv.filter(arg => arg.startsWith('--remove-path=')).map(arg => arg.slice(14));
    console.log(JSON.stringify(operation({ root, prefixes, removePaths })));
  } else {
  const separator = process.argv.indexOf('--');
  const selected = separator < 0 ? [] : process.argv.slice(separator + 1).filter(path => !path.startsWith('-'));
  if (!prefixes.length && process.argv.includes('--store-and-stage')) for (const path of selected) {
    let logical = relative(defaultRoot, resolve(defaultRoot, path)).replaceAll('\\', '/');
    const original = relative(libraryReportRoot(defaultRoot), resolve(defaultRoot, path)).replaceAll('\\', '/');
    if (!original.startsWith('../') && !isAbsolute(original)) logical = 'reports/' + original;
    logical = logical.split(/[*?[]/)[0].replace(/\/$/, '');
    if (libraryConfig().mounts.some(mount => logical === mount || logical.startsWith(mount + '/'))) prefixes.push(logical);
  }
  const storeOptions = { push: process.argv.includes('--push'), prefixes: prefixes.length ? prefixes : null,
    removePaths: process.argv.filter(arg => arg.startsWith('--remove-path=')).map(arg => arg.slice(14)),
    retirement: process.argv.some(arg=>arg.startsWith("--retirement-manifest="))?JSON.parse(readFileSync(resolve(process.argv.find(arg=>arg.startsWith("--retirement-manifest=")).slice("--retirement-manifest=".length)))):null };
  if (process.argv.includes('--store-and-stage')) {
    if (prefixes.length) storeLibraryData(storeOptions);
    const root = defaultRoot, mounts = libraryConfig(root).mounts;
    const paths = process.argv.slice(process.argv.indexOf('--') + 1).filter(path => !path.startsWith('-')).filter(path => {
      const logical = relative(root, resolve(root, path)).replaceAll('\\', '/');
      return !isAbsolute(path) && !logical.startsWith('../') && !mounts.some(mount => logical === mount || logical.startsWith(mount + '/'));
    });
    git(root, ['add', '--', 'config/library-data.json', ...paths]);
  } else if (process.argv.includes('--store')) console.log(`Library stored: ${storeLibraryData(storeOptions)}`);
  else {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || defaultRoot;
    const purpose = process.argv.find(arg => arg.startsWith('--purpose='))?.slice(10) || 'viewer';
    const projectId=process.argv.find(arg=>arg.startsWith('--project='))?.slice('--project='.length)
      ??(purpose==='viewer'?'default-world':null);
    const result = prepareLibraryData({ root, purpose, prefixes, projectId });
    console.log(`Library prepared (${purpose}): ${result.repository}@${result.revision}`);
  }
  }
  }
}
