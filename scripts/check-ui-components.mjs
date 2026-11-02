import {validateReviewUi} from './lib/reviewer-ui-contracts.mjs';
const failures=validateReviewUi('components');
if(failures.length){
  console.error('Viewer/Windows components audit failed:');
  for(const reason of failures)console.error('- '+reason);
  process.exitCode=1;
}else console.log('Viewer/Windows components audit passed.');
