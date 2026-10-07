/* ------------------------------------------------------------------ *
 *  The physics engine: Rapier 0.21.
 *
 *  Its SIMD build does several sums at once - about twice as fast - on any
 *  browser that supports it (Chrome and Android since 2021, Safari and
 *  iPhones since iOS 16.4). Anything older gets the plain build, which
 *  behaves the same, just slower.
 *
 *      const RAPIER = await loadRapier();
 *
 *  For tests: globalThis.RAPIER_BUILD = 'plain' forces the plain build.
 * ------------------------------------------------------------------ */

// the smallest module that uses a SIMD instruction: valid only where SIMD works
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
                                   10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export const simd = globalThis.RAPIER_BUILD !== 'plain' &&
  typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);

export async function loadRapier() {
  const R = await import(simd ? './vendor/rapier-simd.es.js?v=21' : './vendor/rapier.es.js?v=21');
  await R.init();
  return R;
}
