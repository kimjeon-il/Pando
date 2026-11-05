import {validateReviewUi} from './lib/reviewer-ui-contracts.mjs';

const mode = process.argv[2];
const failures = validateReviewUi(mode);
if (failures.length) {
  console.error(`Viewer/Windows ${mode} audit failed:`);
  for (const reason of failures) console.error('- ' + reason);
  process.exitCode = 1;
} else console.log(`Viewer/Windows ${mode} audit passed.`);
