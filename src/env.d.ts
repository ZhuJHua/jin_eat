/// <reference types="vite/client" />

/** Unique id of this build (commit sha + timestamp). Injected by vite.config.ts `define`. Used to version the SW cache. */
declare const __BUILD_ID__: string;
