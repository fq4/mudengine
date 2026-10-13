/**
 * What `node --import` loads to run a script against the TypeScript sources.
 *
 * `tsx` for the `.ts` imports, then `raw-hook.mjs` for the one `?raw` import
 * the main process makes (see that file). One entry point rather than two
 * `--import` flags per script, so the next hook the sources need goes here
 * and not into twenty lines of `package.json`.
 */
import { register } from 'node:module';
import 'tsx';

// `tsx` installs an asynchronous loader. Registering the raw-import hook with
// the synchronous `registerHooks` API makes its `next()` result undefined on
// Node 22, which prevents every source-based probe from starting. Use the
// asynchronous registration API so the hooks compose correctly.
register('./raw-hook.mjs', import.meta.url);
