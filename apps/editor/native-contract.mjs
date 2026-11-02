// Pure input and artifact contracts shared by the CI producer and local consumer.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
export const nativeTargets=Object.freeze({windows:'x86_64-pc-windows-msvc'});
export const nativeModes=['development','offline','verification'];
export const nativeHash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Offline and verification builds package the *Viewer* product, not the archived
// graphical editor. This audited list includes the actual staging tools and
// the pure serializer extracted to tools/gis (required by the tiny verification fixture).
// Do not add apps/editor/frontend/**, apps/editor/templates/** or apps/editor/*.js
// globs here. The test fixture imports the extracted serializer without the editor source tree.
export const nativePackagedInputPaths=Object.freeze([
  'shared/frontend',
  'apps/viewer',
  'apps/editor/stage.mjs',
  'apps/editor/world-data-plan.mjs',
  'apps/editor/fixture.mjs',
  'apps/editor/network-guard.js',
  'apps/editor/document-transfer-contract.js',
  'tools/gis/project-serializer.js',
  'tests/helpers/core-startup.mjs',
  'tests/helpers/core-project.mjs',
  'tests/helpers/core-session.mjs',
  'tests/helpers/core-session-node-worker.mjs',
  'tools/load-node-core.mjs',
  'tools/package-shared-core-assets.mjs',
  'scripts/lib',
  'scripts/build-ui-bundle.mjs',
  'scripts/p3-preview-server.mjs',
  'tools/builtin-country-bytes.mjs',
  'tools/report-paths.mjs',
  'tools/library-data.mjs',
  'tools/library-archive.mjs',
  'tools/library-content.mjs',
  'tools/library-git.mjs',
  'tools/library-report-layout.mjs',
  'tools/library-runtime-index.mjs',
  'tools/worktree-storage.mjs',
  'tools/worktree-generated.mjs',
  'config/library-data.json',
  'package.json',
  'pnpm-lock.yaml',
]);
// The probe is injected into review.html only in an explicit verification build.
export const nativeVerificationInputPaths=Object.freeze(['apps/editor/review-probe.js']);

export function nativeBuildSelection(paths,{platform}={}){
 if(platform){if(platform==='all')return ['windows'];if(!Object.hasOwn(nativeTargets,platform))throw Error('Unsupported native platform');return [platform];}
 const common=paths.some(p=>/^apps\/editor\/src-tauri\/(?:src\/|capabilities\/|permissions\/|icons\/|Cargo\.|build\.rs$|tauri\.)/.test(p)||['apps/editor/native-contract.mjs','apps/editor/native-producer.mjs','apps/editor/packaged-artifacts.mjs','config/toolchain-versions.json','config/native-artifacts.json','.github/workflows/remote-development-p1.yml'].includes(p));
 // Auto-schedule only native-source changes; frontend packages use separate staging checks.
 return common?['windows']:[];
}
export function nativeInputIdentity(root,{platform,mode}){
 if(!Object.hasOwn(nativeTargets,platform))throw Error('Unsupported native platform');
 if(!nativeModes.includes(mode))throw Error('Unsupported native mode');
 root=resolve(root);const files=new Map();
 const add=p=>{if(p==='assets/data'||p.endsWith('/README.md'))return;const full=join(root,p);if(!existsSync(full))return;const s=lstatSync(full);if(s.isSymbolicLink())throw Error('Linked native source must be preserved: '+p);if(s.isDirectory()){for(const name of readdirSync(full).sort())add(p+'/'+name);return;}if(!s.isFile())throw Error('Non-file native input');const bytes=readFileSync(full);const textInput=/\.(?:rs|toml|lock|json|m?js|cjs|css|html|xml|kt|kts|properties|ps1|sh|txt|md|svg|ya?ml)$/.test(p)||/(?:^|\/)(?:NOTICE|LICENSE)$/.test(p);files.set(p,nativeHash(textInput?Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n')):bytes));};
 const base='apps/editor/src-tauri/';
 for(const p of ['Cargo.toml','Cargo.lock','build.rs','src','capabilities','permissions','icons','tauri.conf.json','tauri.dev.json','tauri.verification.json'])add(base+p);
 for(const p of ['config/toolchain-versions.json','config/native-artifacts.json','apps/editor/native-contract.mjs','apps/editor/native-producer.mjs'])add(p);
 for(const p of [base+'Cargo.toml',base+'Cargo.lock',base+'src/lib.rs'])if(!files.has(p))throw Error('Missing native source: '+p);
 const library=JSON.parse(readFileSync(join(root,'config/library-data.json'))),toolchain=JSON.parse(readFileSync(join(root,'config/toolchain-versions.json'))),cli=JSON.parse(readFileSync(join(root,'apps/editor/package.json'))).devDependencies['@tauri-apps/cli'];
 if(mode!=='development'){
  for(const p of nativePackagedInputPaths)add(p);
  if(mode==='verification')for(const p of nativeVerificationInputPaths)add(p);
  files.set('library-revision',library.revision);
  // Packaged HTML/build metadata and the embedded executable identify the exact
  // Git commit. Keep this provenance-bound even when two commits share source bytes.
  files.set('source-commit',execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());
 }
 const inputs=Object.fromEntries([...files].sort(([a],[b])=>a.localeCompare(b))),configuration={contractVersion:1,platform,target:nativeTargets[platform],mode,rust:toolchain.rust,cli,repository:library.repository,inputs};
 if(!/^\d+\.\d+\.\d+$/.test(toolchain.rust||''))throw Error('Native Rust version must be pinned');
 return {platform,target:nativeTargets[platform],mode,toolchainVersion:toolchain.rust,sha256:nativeHash(JSON.stringify(configuration)),inputs};
}
function bundlePath(root,p){if(typeof p!=='string'||!p||p.includes('\\')||p.split('/').some(s=>!s||s==='.'||s==='..')||p.includes(':')||p.startsWith('/'))throw Error('Native artifact path escaped scope');const full=resolve(root,p);for(let at=full;at!==resolve(root);at=resolve(at,'..'))if(existsSync(at)&&lstatSync(at).isSymbolicLink())throw Error('Linked native artifact path');return full;}
export function verifyNativeBundle(directory,identity){
 const manifest=JSON.parse(readFileSync(bundlePath(directory,'native-artifact.json')));
 if(manifest.schema!==1||!nativeModes.includes(manifest.mode)||manifest.platform!==identity.platform||manifest.target!==identity.target||manifest.mode!==identity.mode||manifest.nativeInputSha256!==identity.sha256||manifest.toolchainVersion!==identity.toolchainVersion||!/^[a-f0-9]{40}$/.test(manifest.sourceCommit||''))throw Error('Native artifact input/platform/mode identity mismatch');
 if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Native artifact files are missing');
 const seen=new Set();for(const file of manifest.files){const full=bundlePath(directory,file.path);if(seen.has(file.path))throw Error('Duplicate native artifact path');seen.add(file.path);if(!/^\w[\w.-]*$/.test(file.path)||!['pandolab-web-shell.exe','WebView2Loader.dll',...(identity.mode==='offline'?['PandoLab-setup.exe']:[])].includes(file.path))throw Error('Unexpected native artifact path');const bytes=readFileSync(full);if(bytes.length!==file.bytes||nativeHash(bytes)!==file.sha256)throw Error('Native artifact bytes/hash differ: '+file.path);}
 for(const name of readdirSync(directory))if(name!=='native-artifact.json'&&!seen.has(name))throw Error('Unlisted native artifact payload: '+name);
 if(!seen.has('pandolab-web-shell.exe'))throw Error('Required native binary is absent');
 if(identity.mode==='offline'&&!seen.has('PandoLab-setup.exe'))throw Error('Required Windows installer is absent');
 return manifest;
}
