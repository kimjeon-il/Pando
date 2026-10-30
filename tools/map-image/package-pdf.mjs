import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants,copyFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {packageNativeTool} from '../native-tool.mjs';
import {mapPdfSourceFiles} from './native-pdf.mjs';

const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'},sdk:{type:'string'}}});
if(!values.binary||!values.directory||!values.sdk)throw Error('binary, directory and sdk are required');
const platform=process.platform,library=platform==='win32'?'mupdfcpp64.dll':'libmupdf.so.26.11';
const expected=platform==='win32'?'b1ba5816e64d2b321b2a21f89c3a9aa39a493f97519ffbeec3b1e30708a32184':
  '2802c2bfedc5b2f4381d93dc2367c9987fa307fabc45c7a041d819c950cc5791';
const runtime=resolve(values.sdk,library);
if(createHash('sha256').update(readFileSync(runtime)).digest('hex')!==expected)throw Error('Unexpected MuPDF SDK runtime');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
packageNativeTool({binary:values.binary,directory:values.directory,root:process.cwd(),target:'map-pdf',platform,
  architecture:process.arch,revision,sourceFiles:mapPdfSourceFiles,runtimeVersion:'mupdf-1.26.11'});
copyFileSync(runtime,join(values.directory,library),constants.COPYFILE_EXCL);
