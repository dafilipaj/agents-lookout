/** Lookout's local server port. Override with LOOKOUT_PORT. */
export const DEFAULT_PORT = 4747;

/** Vite's dev server port (`pnpm dev` only). Override with LOOKOUT_DEV_PORT. */
export const DEFAULT_DEV_PORT = 4748;

/** The Fleet revision Lookout is tested against (decision 0004). */
export const FLEET_INSTALL_COMMAND =
  'cargo install --git https://github.com/ilucin/fleet --rev 38a461c --locked fleet';

/** How cli-toolbox installs tb-session (HIST); it lands in ~/.local/bin. */
export const TB_SESSION_INSTALL_COMMAND =
  'gh api -H "Accept: application/vnd.github.raw" repos/productiveio/cli-toolbox/contents/scripts/install.sh | bash -s -- tb-session';

/** How cli-toolbox installs tb-pr (WORK-7.1); it lands in ~/.local/bin. */
export const TB_PR_INSTALL_COMMAND =
  'gh api -H "Accept: application/vnd.github.raw" repos/productiveio/cli-toolbox/contents/scripts/install.sh | bash -s -- tb-pr';

/**
 * How to get a tb-prod that reads WORK's filter (WORK-7.1, WORK-7.8): built from cli-toolbox's `main`,
 * since no release has `folder_status` and its install script no longer installs tb-prod. It lands in
 * ~/.local/bin. The repo is private, so cargo fetches through the git CLI and its GitHub sign-in.
 */
export const TB_PROD_INSTALL_COMMAND =
  'CARGO_NET_GIT_FETCH_WITH_CLI=true cargo install --git https://github.com/productiveio/cli-toolbox --branch main --locked --root ~/.local tb-prod';

/** LAUNCH-4.5: a start that Fleet hasn't reported after this long becomes an error. */
export const LAUNCH_TIMEOUT_MS = 15_000;

/** WORK-7.2: what signs tb-prod in to Productive. */
export const TB_PROD_SIGN_IN_COMMAND = 'tb-prod config init';
