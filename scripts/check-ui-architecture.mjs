import {validateReviewUi} from './lib/reviewer-ui-contracts.mjs';
const failures=validateReviewUi('architecture');
if(failures.length){
  console.error('Viewer/Windows architecture audit failed:');
  for(const reason of failures)console.error('- '+reason);
  process.exitCode=1;
}else console.log('Viewer/Windows architecture audit passed.');
