// Pure input and artifact contracts shared by the CI producer and local consumer.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
export const nativeTargets={windows:'x86_64-pc-windows-msvc',android:'aarch64-linux-android','android-x86_64':'x86_64-linux-android'};
export const nativeModes=['development','offline','verification'];
export const nativeHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function nativeBuildSelection(paths,{platform}={}){
 if(platform){if(platform==='all')return ['windows','android'];if(!Object.hasOwn(nativeTargets,platform))throw Error('Unsupported native platform');return [platform];}
 const android=paths.some(p=>p.startsWith('apps/editor/src-tauri/android/')||p==='apps/editor/src-tauri/sync-android.mjs');
 const common=paths.some(p=>/^apps\/editor\/src-tauri\/(?:src\/|capabilities\/|permissions\/|icons\/|Cargo\.|build\.rs$|tauri\.)/.test(p)||['apps/editor/native-contract.mjs','apps/editor/native-producer.mjs','apps/editor/packaged-artifacts.mjs','config/toolchain-versions.json','config/native-artifacts.json','.github/workflows/remote-development-p1.yml'].includes(p));
 return common?['windows','android']:android?['android']:[];
}
export function nativeInputIdentity(root,{platform,mode}){
 if(!Object.hasOwn(nativeTargets,platform))throw Error('Unsupported native platform');
 if(!nativeModes.includes(mode))throw Error('Unsupported native mode');
 root=resolve(root);const files=new Map();
 const add=p=>{if(p==='assets/data'||p.endsWith('/README.md'))return;const full=join(root,p);if(!existsSync(full))return;const s=lstatSync(full);if(s.isSymbolicLink())throw Error('Linked native source must be preserved: '+p);if(s.isDirectory()){for(const name of readdirSync(full).sort())add(p+'/'+name);return;}if(!s.isFile())throw Error('Non-file native input');const bytes=readFileSync(full);files.set(p,nativeHash(/\.(?:rs|toml|lock|json|m?js|cjs|css|html|xml|kt|kts|properties|ps1|sh|txt|md|svg)$/.test(p)?Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n')):bytes));};
 const base='apps/editor/src-tauri/';
 for(const p of ['Cargo.toml','Cargo.lock','build.rs','src','capabilities','permissions','icons','tauri.conf.json','tauri.dev.json','tauri.verification.json'])add(base+p);
 if(platform.startsWith('android')){add(base+'android');add(base+'sync-android.mjs');}
 for(const p of ['config/toolchain-versions.json','config/native-artifacts.json','apps/editor/native-contract.mjs','apps/editor/native-producer.mjs'])add(p);
 for(const p of [base+'Cargo.toml',base+'Cargo.lock',base+'src/lib.rs'])if(!files.has(p))throw Error('Missing native source: '+p);
 const library=JSON.parse(readFileSync(join(root,'config/library-data.json'))),toolchain=JSON.parse(readFileSync(join(root,'config/toolchain-versions.json'))),cli=JSON.parse(readFileSync(join(root,'apps/editor/package.json'))).devDependencies['@tauri-apps/cli'];
 if(mode!=='development'){for(const p of ['shared/frontend','apps/viewer','apps/editor/frontend','apps/editor/templates','apps/editor/stage.mjs','apps/editor/world-data-plan.mjs','apps/editor/fixture.mjs','scripts/lib','scripts/build-ui-bundle.mjs','package.json'])add(p);for(const name of readdirSync(join(root,'apps/editor')))if(/\.js$/.test(name))add('apps/editor/'+name);files.set('library-revision',library.revision);files.set('source-commit',execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());}
 const inputs=Object.fromEntries([...files].sort(([a],[b])=>a.localeCompare(b))),configuration={contractVersion:1,platform,target:nativeTargets[platform],mode,rust:toolchain.rust,cli,repository:library.repository,inputs};
 if(!/^\d+\.\d+\.\d+$/.test(toolchain.rust||''))throw Error('Native Rust version must be pinned');
 return {platform,target:nativeTargets[platform],mode,toolchainVersion:toolchain.rust,sha256:nativeHash(JSON.stringify(configuration)),inputs};
}
function bundlePath(root,p){if(typeof p!=='string'||!p||p.includes('\\')||p.split('/').some(s=>!s||s==='.'||s==='..')||p.includes(':')||p.startsWith('/'))throw Error('Native artifact path escaped scope');const full=resolve(root,p);for(let at=full;at!==resolve(root);at=resolve(at,'..'))if(existsSync(at)&&lstatSync(at).isSymbolicLink())throw Error('Linked native artifact path');return full;}
export function verifyNativeBundle(directory,identity,{androidCertificateSha256}={}){
 const manifest=JSON.parse(readFileSync(bundlePath(directory,'native-artifact.json')));
 if(manifest.schema!==1||!nativeModes.includes(manifest.mode)||manifest.platform!==identity.platform||manifest.target!==identity.target||manifest.mode!==identity.mode||manifest.nativeInputSha256!==identity.sha256||manifest.toolchainVersion!==identity.toolchainVersion||!/^[a-f0-9]{40}$/.test(manifest.sourceCommit||''))throw Error('Native artifact input/platform/mode identity mismatch');
 if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Native artifact files are missing');
 const seen=new Set();for(const file of manifest.files){const full=bundlePath(directory,file.path);if(seen.has(file.path))throw Error('Duplicate native artifact path');seen.add(file.path);if(!/^\w[\w.-]*$/.test(file.path)||!['pandolab-web-shell.exe','WebView2Loader.dll','app.apk'].includes(file.path))throw Error('Unexpected native artifact path');const bytes=readFileSync(full);if(bytes.length!==file.bytes||nativeHash(bytes)!==file.sha256)throw Error('Native artifact bytes/hash differ: '+file.path);}
 for(const name of readdirSync(directory))if(name!=='native-artifact.json'&&!seen.has(name))throw Error('Unlisted native artifact payload: '+name);
 const binary=identity.platform==='windows'?'pandolab-web-shell.exe':'app.apk';if(!seen.has(binary))throw Error('Required native binary is absent');
 if(identity.platform.startsWith('android')){const signer=apkCertificateSha256(readFileSync(join(directory,binary)));if(!/^[a-f0-9]{64}$/.test(androidCertificateSha256||'')||signer!==androidCertificateSha256||manifest.androidCertificateSha256!==signer)throw Error('Android signing certificate mismatch; existing app must not be uninstalled');}
 return manifest;
}
export function apkCertificateSha256(bytes){
 const fail=()=>{throw Error('Invalid APK signing block size or ZIP structure');};
 if(!Buffer.isBuffer(bytes)||bytes.length<22)fail();let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50&&p+22+bytes.readUInt16LE(p+20)===bytes.length){end=p;break;}
 if(end<0)fail();const central=bytes.readUInt32LE(end+16);if(central<32||central>end||bytes.subarray(central-16,central).toString()!=='APK Sig Block 42')fail();
 const size=Number(bytes.readBigUInt64LE(central-24));if(!Number.isSafeInteger(size)||size<24||size+8>central)fail();const start=central-size-8;if(Number(bytes.readBigUInt64LE(start))!==size)fail();
 const lp=(buffer,offset=0)=>{if(offset+4>buffer.length)fail();const length=buffer.readUInt32LE(offset);if(length>buffer.length-offset-4)fail();return{bytes:buffer.subarray(offset+4,offset+4+length),next:offset+4+length};};
 for(let p=start+8;p<central-24;){if(p+12>central-24)fail();const n=Number(bytes.readBigUInt64LE(p));if(!Number.isSafeInteger(n)||n<4||p+8+n>central-24)fail();const id=bytes.readUInt32LE(p+8),value=bytes.subarray(p+12,p+8+n);p+=8+n;if(id!==0x7109871a)continue;
  const signers=lp(value);if(signers.next!==value.length)fail();const signer=lp(signers.bytes);if(signer.next!==signers.bytes.length)throw Error('Multiple APK signers are unsupported');const signed=lp(signer.bytes).bytes,digests=lp(signed),certs=lp(signed,digests.next),cert=lp(certs.bytes);return nativeHash(cert.bytes);
 }
 throw Error('APK v2 signing certificate is missing');
}
