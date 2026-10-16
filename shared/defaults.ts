/** Lookout's local server port. Override with LOOKOUT_PORT. */
export const DEFAULT_PORT = 4747;

/** Vite's dev server port (`pnpm dev` only). Override with LOOKOUT_DEV_PORT. */
export const DEFAULT_DEV_PORT = 4748;

/** The Fleet revision Lookout is tested against (decision 0004). */
export const FLEET_INSTALL_COMMAND =
  'cargo install --git https://github.com/ilucin/fleet --rev 38a461c --locked fleet';
