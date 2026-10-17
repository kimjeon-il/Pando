# 보고서 이관 기록

> **현행 경로 보정(2026-10-13, `Pando/work/gis`):** 아래 본문은 2026-10-12 당시의 웹·앱 이관 이력을 설명한 역사 기록입니다. 이후 정리에서 `docs/place-*.md`, `docs/research/country-default-colors.*`, 시아첸 연구 증거 및 일부 역사 GIS 검토 결과를 루트 `reports/`로 옮겼고, `native/reports/places/`의 동일 자료는 루트 정본으로 통일했습니다. 당시에 이동하지 않았다는 문장은 당시 상태를 말하며 현재 파일 경로 정책이 아닙니다.

이 문서는 웹·앱을 별도 저장소로 관리하던 시점의 보고서 이관 증거다. 현재 정본은 통합 `Pando/reports/`이며, 아래 원래 저장소 링크와 커밋은 당시 출처를 재현하기 위해 유지한다.

기준: 웹 `e2efceb6788f5b9e1f682916b8b9763f7bc2db85`, 앱 `f535673993f45957b82d125ff766ed1e18233170` (2026-10-12). 정본은 웹 `reports/`이며, 옮긴 본문에는 원래 저장소·경로·커밋을 기록했습니다. 이관은 과거 내용의 과학적 재검증이나 지도 데이터 반영이 아닙니다.

웹 Markdown 이동 23개, 앱 Markdown 이동 40개, 앱의 바이트 동일 중복본 제거 12개.

이관 검사: 기준 커밋의 Git blob SHA-256 75/75 일치, 링크·색인 메타데이터를 제외한 본문 63/63 보존, 색인 63/63 포함. 현재 로컬·원격 브랜치 참조에서 `main`에만 없는 대상 Markdown은 웹·앱 모두 0개였다. 상대 링크 검사는 변경된 Markdown 전체에 대해 별도로 수행한다.

| 출처 | 원래 경로 | 정본 경로 | 원본 SHA-256 | 후속 Web 원본 Git blob SHA | 후속 이관 당시 바이트 비교 |
| --- | --- | --- | --- | --- | --- |
| 웹 | `docs/validation-audit.md` | [정본](development/testing/validation-audit.md) | `d048f603f661ffc5eee25670d2c642f69baaad644ee28a90a6b7ab3eeb14dc98` | `7580c0d5341ad000fabaa51e1e6df6e86b7dfed2` | 다름 |
| 웹 | `docs/russia-edit-responsiveness.md` | [정본](development/testing/russia-edit-responsiveness.md) | `9148d83d9f61ba340eccfed0505bc94075594c2dd6f4e14889d3357a5bccbc41` | `31f265877a8200864b5bebe0e2ac5a44cb4ad9de` | 다름 |
| 웹 | `docs/historical-world-timeline-validation.md` | [정본](development/testing/historical-world-timeline-validation.md) | `a89add3d8855e3b0b7322ae93cf58b42f54ac3b177535ea25c2b0b42744709cf` | `1a92076dd5a01e722b8bb4b70ff7889e155be96a` | 다름 |
| 웹 | `docs/data-versioning-progress.md` | [정본](archive/data-versioning/README.md#arc-004) | `6b6cbd679c4e103ad17b31177271f0825ac71fea23881f4b8c1571190768717f` | `f21690dba6b7a48c39a55d53ca2dfc6a05836abb` | 다름 |
| 웹 | `tools/historical-library/sources/netherlands/phase0-canonical-audit.md` | [정본](geography/netherlands/phase0-canonical-audit.md) | `89092106d8f386f7a70514223e62ca0c4e7c84231e59bb779eaa00d81241c4aa` | `4aa14fefe6c00ce358e93efa35355e4c9f8b1e2a` | 다름 |
| 웹 | `tools/historical-library/sources/netherlands/netherlands-land-reclamation-reverse-timeline.md` | [정본](geography/netherlands/land-reclamation-reverse-timeline.md) | `04882765ff5c9fda5572e3d9daa62d7d7c7b49cb1ae308aa85642e67d6eaa20f` | `7fb93cef6128aa5d20e576de6567e14cf1638510` | 다름 |
| 웹 | `tools/historical-library/sources/german-coastline/1914-sh-period-map-overlay-review.md` | [정본](geography/germany/1914-sh-period-map-overlay-review.md) | `e669262f9927db949e31368ccb03d3d6904d49edc6cbd90b7a042fd0b41551ee` | `5bd3afefa16b20575ba6e9bb072e461db78e2df5` | 다름 |
| 웹 | `tools/historical-library/sources/german-coastline/1914-screen-delta-precheck.md` | [정본](geography/germany/1914-screen-delta-precheck.md) | `e38a184f7fb82041f3e3b7835586138c184d1852e637e96670653512929196fe` | `ca56406843392e306624146fa4bced10af06dde2` | 다름 |
| 웹 | `docs/validation/active-hydro-optimization-stage1.md` | [정본](geography/hydro/active-hydro-optimization-stage1.md) | `5370463af3a527211639a8d88495205d35c399290dbb0d987c9212e85078def6` | `9c2b51ee54c6a95d222eba5d2a550166a109c842` | 다름 |
| 웹 | `docs/validation/country-lineage-storage.md` | [정본](development/testing/country-lineage-storage.md) | `833b14c010430a32e2991e76752cd953f7b5ac46b3cc3a338fc6919bdb51cfb4` | `7633a2ff3503f629cdda209ab3c03298ddd618ab` | 다름 |
| 웹 | `docs/validation/data-versioning-phase1-inventory.md` | [정본](archive/data-versioning/README.md#arc-011) | `2dacf84d3498504c740fabb17cac17bafaf3a89a14e5729926cc14d671980741` | `3d395c499d91947e188ddfacc252f0bb5fe6464e` | 다름 |
| 웹 | `docs/validation/data-versioning-phase10.md` | [정본](archive/data-versioning/README.md#arc-012) | `88a3c58923e62c9b739113557b12cb67c3adfa191d92bee9ea86e17c16f2d88d` | `a2f11578360c9899b523a8e90cccb814d040c36d` | 다름 |
| 웹 | `docs/validation/data-versioning-phase11.md` | [정본](archive/data-versioning/README.md#arc-013) | `4fe67d9275fd268aee47d5402981738ff84760bfe3e85f652a3ae036b2752dc9` | `76b187455f8b48b1f6fed2913cbe4a43a4efc540` | 다름 |
| 웹 | `docs/validation/data-versioning-phase2.md` | [정본](archive/data-versioning/README.md#arc-014) | `863329988ac17375cd5a97c40cd1c40245623fc34acf48791a1a3f269cd285f6` | `f2cc609dcb4633f0ab1c1b1ed5c7041a0031cdf4` | 다름 |
| 웹 | `docs/validation/data-versioning-phase3.md` | [정본](archive/data-versioning/README.md#arc-015) | `63aa796c6fd88760331324b1e00739f8489aa37642afd7ee7921ce439974e83d` | `349fa1c338583f8b89c01ce8e3f3aa39eb7d2b35` | 다름 |
| 웹 | `docs/validation/data-versioning-phase6.md` | [정본](archive/data-versioning/README.md#arc-016) | `b237e8c645c0aedc8dc6e881f9fb0c1d50ddf495633e17d0e33b7efce71ff096` | `8f5015440ef242de05cec6cbde2e05d419b729d7` | 다름 |
| 웹 | `docs/validation/data-versioning-phase7.md` | [정본](archive/data-versioning/README.md#arc-017) | `42d79786cc79882f6887c5257d859e1f43c6e5aa2182fe8c13ca45cf1e64b4c7` | `85e25cf44ee825df6200bd6be27e7691cd876b3c` | 다름 |
| 웹 | `docs/validation/data-versioning-phase8.md` | [정본](archive/data-versioning/README.md#arc-018) | `fbe1a14feeb62e8654e702cc887d434130838c83eee1b2d2e0f14775aa22626a` | `0e016fd59f3d304099d9f48147a05c3356a09232` | 다름 |
| 웹 | `docs/validation/data-versioning-phase9.md` | [정본](archive/data-versioning/README.md#arc-019) | `b47ecd86c270e89fc60ca82f1894a1690c356fb29a97f24d55ed663b0eb2228e` | `30e718d692d99508fdc0e400fc0f53eb5f21d353` | 다름 |
| 웹 | `docs/validation/hydro-v0132-retirement-stage4.md` | [정본](archive/hydro/README.md#arc-020) | `a339fd2298f1c673ff187c084edb5238cefff52c9763c6a231d781dfe4f31032` | `6f4b13ce2b3c011e64b627326533412d9d93a249` | 다름 |
| 웹 | `docs/validation/legacy-hydro-stage2.md` | [정본](archive/hydro/README.md#arc-021) | `ed1b56489e63e9f07cd00cef131dc9eeb91b0b40d7c16f69ec99388d6ce2c010` | `c2d3bffd703bbd63035ef2e8493d6aa2723ae845` | 다름 |
| 웹 | `docs/validation/legacy-hydro-stage3.md` | [정본](archive/hydro/README.md#arc-022) | `078ecaae3b70daebe5353415d1adee2e74d18bd3bf92d427cda01295d09d1bbc` | `d223bb2cb97cf36a1c60a2890551495c3e743b69` | 다름 |
| 웹 | `docs/validation/verified-entity-lifetimes.md` | [정본](geography/verified-entity-lifetimes.md) | `b8ccc6310007327a3d8412ce77a013c3eb99be4e6ae2c64108e15f6e371874d7` | `45c0d1c5cec2d7cb1aae61f74f6cd91c6597818d` | 다름 |
| 앱 | `docs/validation/data-versioning-phase1-inventory.md` | [정본](archive/data-versioning/README.md#arc-024) | `c77e0b2bccbbffe87336b3fa2f46dd200fe50a527c4b40225b3a79a2216fef6e` | — | — |
| 앱 | `docs/validation/data-versioning-phase4.md` | [정본](archive/data-versioning/README.md#arc-025) | `050b3e4840120c90ca76bcc51fb2ec61f976885bd4e895536fb305ab851ee949` | — | — |
| 앱 | `docs/validation/data-versioning-phase5.md` | [정본](archive/data-versioning/README.md#arc-026) | `89f0157206735e5611a178250e746413ed157965d356fd64dec1491e61deb374` | — | — |
| 앱 | `docs/validation/hydro-two-file-branch-rollout-2026-10-09.md` | [정본](archive/hydro/README.md#arc-027) | `ef3a22630f23f70b33875c084b9e6644e5f24fbc746db0e497f7e9a3c18a7538` | — | — |
| 앱 | `docs/android-storage-report.md` | [정본](development/app/android-storage-report.md) | `1fbe0f548d4392dd8b989d9729c501ebc9324f977351c2795928a84f8dddf2e7` | — | — |
| 앱 | `docs/final-parity-report.md` | [정본](development/app/final-parity-report.md) | `52b60b5957c27121fa9581567d3627ecb44129119eb6cbe62f45dffaff16e367` | — | — |
| 앱 | `docs/flag-web-parity-20261004.md` | [정본](development/app/flag-web-parity-20261004.md) | `d07e567245145da6a33f216e3cf7a7654a2fd080ae4d5842988e9ac6f1c872a2` | — | — |
| 앱 | `docs/m3-selection-progress.md` | [정본](development/app/m3-selection-progress.md) | `f8dc5568182d87d9fe1708dec9ad51719034f64e16ecc7122bd4130f84e322e6` | — | — |
| 앱 | `docs/m33-verification.md` | [정본](development/app/m33-verification.md) | `6952e31824f22127e408e39812d56b6c7c161f938210d5f1179c19d6e3d3db8b` | — | — |
| 앱 | `docs/m5-closure-audit.md` | [정본](development/app/m5-closure-audit.md) | `b111abe7df1479379d9bee9ed7e623b2fb96982b9a281cc488026ddf2516efea` | — | — |
| 앱 | `docs/m5-display-closure.md` | [정본](development/app/m5-display-closure.md) | `381059d0945410befad7884bf1ccd6edbb430ea87a03cc9670449b1cbaebbb70` | — | — |
| 앱 | `docs/m5-order-verification.md` | [정본](development/app/m5-order-verification.md) | `5b3b808be9064f50061d6e813175b33cc4e31cf7bd261944219b09a65e65dbdb` | — | — |
| 앱 | `docs/m5-v6-validation.md` | [정본](development/app/m5-v6-validation.md) | `192827ff682c5ec3927b157a83bf228ab5caa7572d0e86e1403c12ea20250f57` | — | — |
| 앱 | `docs/m6-status.md` | [정본](development/app/m6-status.md) | `463378afa52fe7ee1a43152f276350a4d0fe170119e7e5197ea6c96771a9d912` | — | — |
| 앱 | `docs/m972-controller-validation.md` | [정본](development/app/m972-controller-validation.md) | `67cb637aa4ad21a55859d588b74ff5b7c3c3e941ba27b9fd5dd205b365162a34` | — | — |
| 앱 | `docs/m972-selection-annex-progress.md` | [정본](development/app/m972-selection-annex-progress.md) | `0812ee8364fe024d0aa2e0fbaf9f960b48378ae8287d501fac10641e4f950760` | — | — |
| 앱 | `docs/m975-recovery-checkpoint.md` | [정본](development/app/m975-recovery-checkpoint.md) | `c4df9ef03795533259c9b3600be614d81fd7ffcae028b0d2b6dca3d4b908803b` | — | — |
| 앱 | `docs/m975-validation-scope.md` | [정본](development/app/m975-validation-scope.md) | `80e64f996ff72c15d92bf234f83eaae13f3e876724b387a3d9b55e27d43610a5` | — | — |
| 앱 | `docs/m977-pending-input-observations.md` | [정본](development/app/m977-pending-input-observations.md) | `12ab4b4f1467cec202ecd896d5de9b36d57799cc84c88962944e1a771c8abc49` | — | — |
| 앱 | `docs/m977-pending-lifecycle-observations.md` | [정본](development/app/m977-pending-lifecycle-observations.md) | `51984127e182d9a8fd12f165c0b9f707c441abb3a27a8a7a1c34b7a598598148` | — | — |
| 앱 | `docs/m98-prepared-input-validation.md` | [정본](development/app/m98-prepared-input-validation.md) | `15d5c9ebd53d15af037d91f5ce5863404e1a36968550f30972393be90f687027` | — | — |
| 앱 | `docs/m98-projection-route-validation.md` | [정본](development/app/m98-projection-route-validation.md) | `5493456fdc1ce3854fd2592ec505a67f683b1940d1de1005d466b663c87739c0` | — | — |
| 앱 | `docs/m98-windows-measurement-e01f0e6.md` | [정본](development/app/m98-windows-measurement-e01f0e6.md) | `401204b22b0cd2ad379d9397b831d3c9ab5d957df9e3b77e1ce1e31894594ee9` | — | — |
| 앱 | `docs/p1-p8-m98-execution-followup.md` | [정본](development/app/p1-p8-m98-execution-followup.md) | `711be5236d05bd613e4cd76bfd63e637a9b07ff173de4c771026d8e40baf8076` | — | — |
| 앱 | `docs/p1-p8-m98-final-893e361.md` | [정본](development/app/p1-p8-m98-final-893e361.md) | `3f5c2fe73b4b769df3069df7e19735f0db704f33aad54d9833af895431227e95` | — | — |
| 앱 | `docs/p8-historical-parent-validation.md` | [정본](development/app/p8-historical-parent-validation.md) | `1acdb26c785c56555e8788c2b0d628041421df6060987123d3e228f9d8ae31cb` | — | — |
| 앱 | `docs/p8-stroke-validation.md` | [정본](development/app/p8-stroke-validation.md) | `b7df360e2255e707d7691f0e2abb0359fd0b2bd4d26dba141fba7e80e3ab2ab4` | — | — |
| 앱 | `docs/place-integration-validation.md` | [정본](places/app-place-integration-validation.md) | `6cd6b4f43a80ee089d5a8c93ed09c6734757441bdfdf76951c435fd27e3cd463` | — | — |
| 앱 | `docs/place-staging-snapshot.md` | [정본](places/app-place-staging-snapshot.md) | `f9c8e3e9aa82f6b693b3a37383920446777cad0a5d99142eedbd5b297764d724` | — | — |
| 앱 | `docs/platform-boundaries-validation.md` | [정본](development/app/platform-boundaries-validation.md) | `19a33080351ac691783226db42c7c6a2706d16fe2ad4be92a85d8b24e2fe8a52` | — | — |
| 앱 | `docs/platform-validation.md` | [정본](development/app/platform-validation.md) | `4efce6b387bf50b5100d7b63a2e1718211e5524f6521c56e042348fc6335062b` | — | — |
| 앱 | `docs/reference-image-main-merge-validation.md` | [정본](development/app/reference-image-main-merge-validation.md) | `3abdd3b1df694622cd7285c18368ac2e83559957311cd66422176b67c9029c50` | — | — |
| 앱 | `docs/reference-image-web-parity-progress.md` | [정본](development/app/reference-image-web-parity-progress.md) | `7d100e7a4517a9414fe970b456251b18ce85f2a82023f0f25f37eaf37f951e77` | — | — |
| 앱 | `docs/reference-image-web-parity-validation.md` | [정본](development/app/reference-image-web-parity-validation.md) | `18162220b978cac5ee8b3ffd86cacf069b701b957a91a27ce8eec85b627f52f0` | — | — |
| 앱 | `docs/terrain-integration-validation.md` | [정본](geography/terrain/app-terrain-integration-validation.md) | `ffa15ddda16c9bb767afa3fd9d2a5e09d2d38a5f9978c8e87707d732fe14e60e` | — | — |
| 앱 | `docs/terrain-p2-validation.md` | [정본](geography/terrain/app-terrain-p2-validation.md) | `02f43a7cebbc91618934a17e271d607fddf87641dd1e35965eb6b2af2e64e94b` | — | — |
| 앱 | `docs/timeline-integration-validation.md` | [정본](development/app/timeline-integration-validation.md) | `685cefbd8ef73b128e66f7300c7315c02d18f8feae6bebd0321b2b40d4a22624` | — | — |
| 앱 | `docs/timeline-persistence-validation.md` | [정본](development/app/timeline-persistence-validation.md) | `2136ab8719bd760632fd7fcea3650df4d649cd1e8fa5873bc4b762494633667c` | — | — |
| 앱 | `docs/web-feature-audit.md` | [정본](development/app/web-feature-audit.md) | `c804271b2c29cc2cad44242501c50af5d6732563ba556326fc62fb9aa7652268` | — | — |
| 앱 | `docs/windows-frame-validation.md` | [정본](development/app/windows-frame-validation.md) | `0b9750b028588ece86814464ebc48b1a1b36297b9337e5e0826b4ecb1c93c9f6` | — | — |
| 앱 (동일 중복) | `docs/validation/data-versioning-phase10.md` | [정본](archive/data-versioning/README.md#arc-012) | `88a3c58923e62c9b739113557b12cb67c3adfa191d92bee9ea86e17c16f2d88d` | — | — |
| 앱 (동일 중복) | `docs/validation/data-versioning-phase11.md` | [정본](archive/data-versioning/README.md#arc-013) | `4fe67d9275fd268aee47d5402981738ff84760bfe3e85f652a3ae036b2752dc9` | — | — |
| 앱 (동일 중복) | `docs/validation/data-versioning-phase6.md` | [정본](archive/data-versioning/README.md#arc-016) | `b237e8c645c0aedc8dc6e881f9fb0c1d50ddf495633e17d0e33b7efce71ff096` | — | — |
| 앱 (동일 중복) | `docs/validation/data-versioning-phase7.md` | [정본](archive/data-versioning/README.md#arc-017) | `42d79786cc79882f6887c5257d859e1f43c6e5aa2182fe8c13ca45cf1e64b4c7` | — | — |
| 앱 (동일 중복) | `docs/validation/data-versioning-phase8.md` | [정본](archive/data-versioning/README.md#arc-018) | `fbe1a14feeb62e8654e702cc887d434130838c83eee1b2d2e0f14775aa22626a` | — | — |
| 앱 (동일 중복) | `docs/validation/data-versioning-phase9.md` | [정본](archive/data-versioning/README.md#arc-019) | `b47ecd86c270e89fc60ca82f1894a1690c356fb29a97f24d55ed663b0eb2228e` | — | — |
| 앱 (동일 중복) | `docs/data-versioning-progress.md` | [정본](archive/data-versioning/README.md#arc-004) | `6b6cbd679c4e103ad17b31177271f0825ac71fea23881f4b8c1571190768717f` | — | — |
| 앱 (동일 중복) | `docs/historical-world-timeline-validation.md` | [정본](development/testing/historical-world-timeline-validation.md) | `a89add3d8855e3b0b7322ae93cf58b42f54ac3b177535ea25c2b0b42744709cf` | — | — |
| 앱 (동일 중복) | `tools/historical-library/sources/netherlands/phase0-canonical-audit.md` | [정본](geography/netherlands/phase0-canonical-audit.md) | `89092106d8f386f7a70514223e62ca0c4e7c84231e59bb779eaa00d81241c4aa` | — | — |
| 앱 (동일 중복) | `tools/historical-library/sources/netherlands/netherlands-land-reclamation-reverse-timeline.md` | [정본](geography/netherlands/land-reclamation-reverse-timeline.md) | `04882765ff5c9fda5572e3d9daa62d7d7c7b49cb1ae308aa85642e67d6eaa20f` | — | — |
| 앱 (동일 중복) | `tools/historical-library/sources/german-coastline/1914-sh-period-map-overlay-review.md` | [정본](geography/germany/1914-sh-period-map-overlay-review.md) | `e669262f9927db949e31368ccb03d3d6904d49edc6cbd90b7a042fd0b41551ee` | — | — |
| 앱 (동일 중복) | `tools/historical-library/sources/german-coastline/1914-screen-delta-precheck.md` | [정본](geography/germany/1914-screen-delta-precheck.md) | `e38a184f7fb82041f3e3b7835586138c184d1852e637e96670653512929196fe` | — | — |

## 이동하지 않은 자료와 이유

- 빌드·검증이 직접 읽는 `reports/places/*.json`, `docs/validation/*.json`, `tools/historical-library/sources/**/*.json`, 앱 `docs/platform-validation.json` 등은 실행 입력 또는 원본 증거입니다.
- 웹 `docs/place-data-audit.md`와 `docs/place-candidate-review.md`는 `tools/build-place-candidates.py`가 기본 출력 경로로 생성하므로 기존 위치를 유지합니다.
- 역사 자료의 `tools/historical-library/sources/*/README.md`는 원본 데이터와 함께 쓰는 출처 색인입니다. 본문 보고서만 위 정본으로 옮겼습니다.
- 정책·계약·설계·작업 계획과 앱 `docs/evidence/`의 원본 실행 증거는 각 저장소에 유지합니다.
- 확인 가능한 네덜란드·독일 보고서 원문은 Git 기준 커밋에서 이관했습니다. 관련 작업 기록은 네덜란드 복원 `6ac7942e-3a54-83ee-89be-6c776575d953`, 독일제국 해안선 조사 `6ac8b447-3980-83ec-a21f-fe28408c58ca`입니다. 채팅의 출처 미확인 주장이나 미실행 검증을 새 결과로 편입하지 않았습니다.

## 2026-10-14 하위 브랜치 보고서 위치 후속 정리

- 하위 브랜치에서 단독 UI 검증 보고서 `design-qa.md`의 정본을 `reports/development/testing/info-tab-v9-visual-validation-2026-10-06.md`로 이전한다. 보고서 ID `DEV-072`, 당시의 실행/미실행 결과와 증거 제한을 그대로 유지한다.
- 설계 규격·기술 계약·계약과 작업 진행 기록이 섞인 문서, 원본 데이터와 실행 로그는 보고서로 자동 이동하지 않는다.
- 이 조치는 보고서 경로 정리이며 코드 구현 재검증, 데이터 반영, `main` 병합 또는 배포를 뜻하지 않는다.

## 2026-10-14 work/hydro-names 원본 증거 보완

위 웹·앱 이관의 원본 SHA-256과 본문 보존 기록은 유지한다. 후속 Web 기록에서 동일한 원래 경로 23개는 위 표의 Git blob SHA(SHA-1)와 당시 바이트 비교 열로 통합했다. 아래 27개는 후속 기록에만 있는 원본 경로다. 바이트 비교 결과는 당시 이관 판본에 대한 기록이며 현재 정본의 재검증 결과가 아니다.

단독 조사·검증 보고서의 이전 위치와 정본 위치를 기록합니다. 기존 Git blob SHA는 출처 증거로 유지하고, 정본 내용은 현재 `main/reports/`에 저장된 대응 판본을 사용해 상대 경로가 수정된 자료를 우선했습니다. 정본과 원본의 바이트가 다른 경우 그 원인을 '링크만의 차이'로 확정하지 않으며 독립적인 내용 검증이 필요합니다.

원본 GIS 자료, 생성기 입력, 그림·JSON·GeoJSON은 원래 위치를 보존합니다. 보고서가 참조할 수 있도록 이미 분류된 자료의 **참고 사본만** 보고서 디렉터리에 추가했습니다. 제품 코드나 배포, 지도 데이터는 변경하지 않았습니다.

**이관 제외:** `docs/validation/data-versioning-phase11-policy.md`(정책), `.superpowers/sdd/2026-10-03-unified-objects/progress.md`(개발 지시·계약 혼재), `docs/architecture/`, `docs/superpowers/`, `native/docs/`, 테스트 원시 로그 및 머신 출력.

| 기존 보고서 위치 | 새 정본 위치 | 기존 Git blob SHA | SHA 동일 여부 |
| --- | --- | --- | --- |
| `assets/data/research/siachen/README_control.md` | [정본](research/siachen/README_control.md) | `68a97623c6b4d69c12a8442ebb8f64cbc7901681` | 동일 |
| `assets/data/research/siachen/README_dem_sia_bilafond.md` | [정본](research/siachen/README_dem_sia_bilafond.md) | `5200fa5a95b5ad8a1908712b39051a99d3b63b8e` | 동일 |
| `assets/data/research/siachen/README_discrepancy.md` | [정본](research/siachen/README_discrepancy.md) | `d02646b0a1c361f51bba15b888a822631c15a06f` | 동일 |
| `assets/data/research/siachen/README_multidem_ridge.md` | [정본](research/siachen/README_multidem_ridge.md) | `74f1e57848b2373cccc0aa839e6b08b4611d2675` | 동일 |
| `assets/data/research/siachen/README_s2_km90.md` | [정본](research/siachen/README_s2_km90.md) | `fa5af25725bd8e6664bd49e3f2e8a77c6ee870d4` | 동일 |
| `assets/data/research/siachen/README_s2_optical.md` | [정본](research/siachen/README_s2_optical.md) | `5b1fd0e466e73dde20c5cd00ae72f7337b0fca82` | 동일 |
| `assets/data/research/siachen/README_saltoro_terrain_continuity.md` | [정본](research/siachen/README_saltoro_terrain_continuity.md) | `fe2f432e61529f3ca8e5c4bbba938f8d2e4e0124` | 동일 |
| `assets/data/research/siachen/README.md` | [정본](research/siachen/README.md) | `20db2ad93ddee1fbad8e6d0da0141fe56aa35e9c` | 동일 |
| `assets/data/research/siachen/REVIEW_agpl_vs_glacier_2026-10-08.md` | [정본](research/siachen/REVIEW_agpl_vs_glacier_2026-10-08.md) | `dd618ffdd3c401187c64cc77b6101ddcf9080817` | 동일 |
| `assets/data/research/siachen/REVIEW_saltoro_crosssource_2026-10-08.md` | [정본](research/siachen/REVIEW_saltoro_crosssource_2026-10-08.md) | `23e3b666ee14112e4e76df4b399f82958bf5bbe4` | 동일 |
| `assets/data/research/siachen/REVIEW_SALTORO_MULTI_SOURCE_2026-10-08.md` | [정본](research/siachen/REVIEW_SALTORO_MULTI_SOURCE_2026-10-08.md) | `e961a8f53277668cd2698699c6525395116c467e` | 동일 |
| `assets/data/research/siachen/REVIEW_sentinel2_sia_bilafond_2026-10-08.md` | [정본](research/siachen/REVIEW_sentinel2_sia_bilafond_2026-10-08.md) | `7e204faba5bc2c56dd8c6fb6556509cf6f1a5242` | 동일 |
| `assets/data/research/siachen/REVIEW_sia_bilafond_cop30_2026-10-08.md` | [정본](research/siachen/REVIEW_sia_bilafond_cop30_2026-10-08.md) | `39cf6c47ed815792f93b32897c7f5cd510811459` | 동일 |
| `design-qa.md` | [정본](development/testing/info-tab-v9-visual-validation-2026-10-06.md) | `1a968b9d7e9eef4e784ebf405bc553f44fde6754` | 다름 |
| `docs/place-candidate-review.md` | [정본](places/place-candidate-review.md) | `aad5c862561f48dba626a5985f1fcfc5d4b05335` | 동일 |
| `docs/place-data-audit.md` | [정본](places/place-data-audit.md) | `d70aa51536dfbd845a3a7c2ea2d10da7baef425f` | 동일 |
| `docs/research/country-default-colors.md` | [정본](research/country-default-colors.md) | `2b7020ecfe72b13aa027e4d335f03ebddc1ffedd` | 동일 |
| `tools/historical-library/land-borders/german-denmark-1914-north-schleswig-001-026.0619-hugum-stage4.hotspots.review.md` | [정본](geography/germany/north-schleswig/german-denmark-1914-north-schleswig-001-026.0619-hugum-stage4.hotspots.review.md) | `11f385144a8b87ca01f37aa116bb800b4da7db20` | 다름 |
| `tools/historical-library/land-borders/german-denmark-1914-north-schleswig-001-026.0619-hugum-stage4.review.md` | [정본](geography/germany/north-schleswig/german-denmark-1914-north-schleswig-001-026.0619-hugum-stage4.review.md) | `30cf5c65653f0d6f1241b00ad34612f796699c1d` | 다름 |
| `tools/historical-library/land-borders/german-denmark-1914-north-schleswig-001-026.0717-hvidding-ufer-stage5.review.md` | [정본](geography/germany/north-schleswig/german-denmark-1914-north-schleswig-001-026.0717-hvidding-ufer-stage5.review.md) | `b1715b3b9c0fc54436c9ec3e4a6709e8864da67b` | 다름 |
| `tools/historical-library/land-borders/german-denmark-1914-north-schleswig-001-026.0718-east-stage2.review.md` | [정본](geography/germany/north-schleswig/german-denmark-1914-north-schleswig-001-026.0718-east-stage2.review.md) | `ca6a8cd9a0ce069cdda2e7c2f663fba516d87cb6` | 다름 |
| `tools/historical-library/land-borders/german-denmark-1914-north-schleswig-001-026.0718-west-stage1.review.md` | [정본](geography/germany/north-schleswig/german-denmark-1914-north-schleswig-001-026.0718-west-stage1.review.md) | `6ebaf5bda20cebb7768a0949477baa56dc46cea3` | 다름 |
| `tools/historical-library/land-borders/german-denmark-1914-north-schleswig-001-026.0719-spandet-stage3.review.md` | [정본](geography/germany/north-schleswig/german-denmark-1914-north-schleswig-001-026.0719-spandet-stage3.review.md) | `3ea35fd3a86c00af9313ff530f727853998871f2` | 다름 |
| `tools/historical-library/land-borders/german-denmark-1914-north-schleswig-001-026.review.md` | [정본](geography/germany/north-schleswig/german-denmark-1914-north-schleswig-001-026.review.md) | `31410cfadbafc020e51c6a958235edde8840eacc` | 다름 |
| `tools/historical-library/sources/serbia/serbia-1914-qa.md` | [정본](geography/serbia/serbia-1914-qa.md) | `20eb17c0547f27facc751661c7d6570afb5011a6` | 동일 |
| `tools/historical-library/sources/serbia/serbia-montenegro-1914-border-candidate-qa.md` | [정본](geography/serbia/serbia-montenegro-1914-border-candidate-qa.md) | `e3fed6dfade061c3c1a3d2b3c1af1bf79cf41bde` | 동일 |
| `tools/historical-library/sources/serbia/serbia-montenegro-1914-map-crosscheck.md` | [정본](geography/serbia/serbia-montenegro-1914-map-crosscheck.md) | `9f0720827a0ed7fb9e21678ff6d50529a7e30a40` | 동일 |


## 2026-10-17 과거 단계별 보고서 정리

`ARC-004, ARC-011~022, ARC-024~027` 중 기존 기록 17개는 [데이터 버전 관리 통합 요약](archive/data-versioning/README.md)과 [수계 구버전 통합 요약](archive/hydro/README.md)으로 압축했습니다. 정리 직전 각 문서의 원문은 고정 [Git 커밋 9e301d4adc36](https://github.com/kimjeon-il/Pando/tree/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive)에 그대로 보존됩니다. 원래 SHA, 이관 출처, 현행 원자료 및 실행 입력의 의미는 바꾸지 않았습니다.
