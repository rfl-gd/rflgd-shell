// What a client bundle gets for `@reflagged/shell/secrets`: module secrets
// must never reach the browser, so importing them there fails at once.
throw new Error('@reflagged/shell/secrets is server-only: never import it in client code')
export {}
