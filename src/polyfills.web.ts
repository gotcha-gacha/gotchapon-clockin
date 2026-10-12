// Nothing to polyfill in a browser: it has TextEncoder, crypto.getRandomValues, and no need of a Buffer global for the
// app itself. This file exists so `entrypoint.js` can import the native polyfills unconditionally without them reaching
// the web bundle. Privy's web SDK wants `Buffer` too; that shim is `privyBuffer.web.ts`, inside the Privy chunk (W5.1),
// so `buffer` stays out of the first paint.
export {};
