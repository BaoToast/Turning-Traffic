/*
 * Cloudflare runtime bindings used by db/index.ts.
 *
 * Keep this declaration in source control so a clean `npm ci` checkout can
 * run TypeScript validation without relying on a locally generated Wrangler
 * file. The runtime still injects the actual binding values.
 */
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}
