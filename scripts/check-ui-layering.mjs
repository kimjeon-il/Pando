import {validateReviewUi} from './lib/reviewer-ui-contracts.mjs';
const failures=validateReviewUi('layering');
if(failures.length){
  console.error('Viewer/Windows layering audit failed:');
  for(const reason of failures)console.error('- '+reason);
  process.exitCode=1;
}else console.log('Viewer/Windows layering audit passed.');
