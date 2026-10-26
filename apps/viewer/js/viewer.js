import { composeViewer } from './modules/viewer-composition.js';
const status = document.getElementById('viewerStatus');
Promise.resolve()
  .then(() => composeViewer({ productMode: 'viewer', meta: globalThis.PANDOLAB_BUILD_META }))
  .catch(error => {
    console.error('[PL-VIEWER-START]', error);
    status.hidden = false;
    status.textContent = '지도를 열지 못했습니다. 새로고침해 다시 시도하세요.';
    status.setAttribute('role', 'alert');
  });
