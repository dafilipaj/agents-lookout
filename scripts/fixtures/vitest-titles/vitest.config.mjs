// Its own config, so scripts/vitest-titles.mjs run here collects only this folder. The repo's Vitest
// includes `*.test.mjs`, never these `*.spec.mjs` files.
export default { test: { include: ['*.spec.mjs'] } };
