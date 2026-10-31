# G1-G3 GPU recovery candidate: G4 verification input

This is a verification-only source fixture, not application runtime data and not an approved production integration.

Concatenate the three binary parts in numeric order to reconstruct the gzip JSON source bundle. The combined SHA-256 is `943b887fb3395b38803e7035d5e38111cb07ad95768bf99cf479614d57a21b2c`. The parts preserve exact bytes through the connector transfer boundary. The JSON includes the 68 reviewed source edits, the new recovery controller, and the updated shared-pass test from the user's G1+G2+G3 candidate.

`tests/helpers/prepare-gpu-recovery-candidate.mjs` verifies source Git blob identities, payload digests and clean affected paths before applying this fixture in a disposable CI checkout only. It does not change a pin, commit, push, deploy or replace a whole renderer with a test excerpt. Run the actual browser product suite after application; a successful fixture application is not G4 success.

Remove the fixture/apply step when the independently reviewed production integration is committed; do not run both old and new runtime implementations.
