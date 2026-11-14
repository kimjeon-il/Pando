import {validateNaturalSurfaceManifest} from './terrain-manifest.js';

// Immutable, data-library-only experimental catalog. It never modifies the
// operational terrain pin, project manifest, or the published Viewer by itself.
export const NATURAL_SURFACE_PREVIEW_CATALOG =
  'https://raw.githubusercontent.com/kimjeon-il/PandoLab-library/82edd7181c158940c482d6621a403bd8667fda72/terrain/natural/candidates/v0.1.0-preview.1.json';
// Entire world source at the six existing DEM LODs. It is intentionally a
// candidate rather than the operational project terrain pin; only nine
// observed patches carry the finer WorldCover/glacier corrections.
export const NATURAL_SURFACE_WORLD_CATALOG =
  'https://raw.githubusercontent.com/kimjeon-il/PandoLab-library/3bfcc53740587afbf1734a3e729426a9566fd4ae/terrain/natural/candidates/v0.2.0-world.1.json';
// 2021-observed WorldCover/RGI7/polar masks, nine regional samples only.
// Explicit opt-in; never replace the published project data pin.
export const NATURAL_SURFACE_OBSERVED_CATALOG =
  'https://raw.githubusercontent.com/kimjeon-il/PandoLab-library/f7d6b6402f3a89fb8738bf6169aa7d7e553992f9/terrain/natural/candidates/v0.1.0-preview.2.json';

export async function loadNaturalSurfaceCandidate({dem, catalogUrl, signal, fetchFn = fetch} = {}) {
  if (!catalogUrl) return null;
  if (!dem?.levels?.length) throw new TypeError('Numerical terrain manifest required before surface admission');
  const url = new URL(String(catalogUrl));
  if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com'
      || !/^\/kimjeon-il\/PandoLab-library\/[a-f0-9]{40}\/terrain\/natural\/candidates\/v[0-9a-z.-]+\.json$/.test(url.pathname)
      || url.search || url.hash)
    throw new TypeError('Natural terrain catalog must use an immutable reviewed library revision');
  const response = await fetchFn(url, {signal});
  if (!response.ok) throw new Error('Natural terrain catalog HTTP ' + response.status);
  const value = await response.json();
  return validateNaturalSurfaceManifest(value, dem);
}
