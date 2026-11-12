/// <reference types="vite/client" />

// Injected by Vite `define` in vite.config.js: the app version comes from
// the repo-root VERSION file, the channel from the build's git branch
// (or VITE_APP_CHANNEL); it is "" when unknown.
declare const __APP_VERSION__: string;
declare const __APP_CHANNEL__: string;
