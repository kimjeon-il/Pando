import {validateReviewUi} from './lib/reviewer-ui-contracts.mjs';
const failures=validateReviewUi('information');
if(failures.length){
  console.error('Viewer/Windows information audit failed:');
  for(const reason of failures)console.error('- '+reason);
  process.exitCode=1;
}else console.log('Viewer/Windows information audit passed.');
