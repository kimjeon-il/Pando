import { composeViewer } from './modules/viewer-composition.js';
import { publicDataRoot, resolvePublicDataChannel } from "../../../shared/frontend/js/modules/publication-data-channel.js";
const status = document.getElementById('viewerStatus');
resolvePublicDataChannel({ baseUrl: publicDataRoot(import.meta.url), buildMeta: globalThis.PANDOLAB_BUILD_META })
  .then(({ meta, status: dataStatus }) => {
    globalThis.PANDOLAB_BUILD_META = meta;
    if (dataStatus === 'offline-verified') {
      const notice = document.createElement('span');
      notice.setAttribute('role', 'status');
      notice.textContent = '오프라인 · 마지막으로 검증한 라이브러리 판본';
      status.insertAdjacentElement('afterend', notice);
    }
    return composeViewer({ productMode: 'viewer', meta });
  })
  .catch(error => {
    console.error('[PL-VIEWER-START]', error);
    status.hidden = false;
    status.textContent = '지도를 열지 못했습니다. 새로고침해 다시 시도하세요.';
    status.setAttribute('role', 'alert');
  });
