const escapeHtml = (v: string): string =>
  v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const PROVIDER_ERRORS = new Set([
  'access_denied',
  'invalid_grant',
  'login_required',
  'consent_required',
  'interaction_required',
  'server_error',
  'temporarily_unavailable',
  'invalid_request',
  'invalid_scope',
  'unauthorized_client',
])

/**
 * Maps an `error` from the callback URL to a known OAuth error code, or
 * `unknown_error`: the URL is anyone's to craft, so its code is never shown as is.
 */
export function providerErrorCode(raw: string): string {
  return PROVIDER_ERRORS.has(raw) ? raw : 'unknown_error'
}

/**
 * A readable page for a sign-in the provider refused. 403 for access_denied
 * (the account exists, the instance is not theirs), 400 for anything else.
 * The description is the provider's own sentence. Callers pass it only when
 * it can be trusted to come from the provider; it is escaped all the same.
 */
export function deniedPage(error: string, description: string | null): Response {
  const status = error === 'access_denied' ? 403 : 400
  // invalid_grant: the code belongs to a provider session that is no longer
  // valid. Trying again lands in that same session, so the way out is to end
  // it — signing out at the platform — not to ask an administrator.
  const expired = error === 'invalid_grant'
  const headline =
    error === 'access_denied'
      ? 'Kein Zugriff auf diese Anwendung'
      : expired
        ? 'Anmeldung abgelaufen'
        : 'Anmeldung fehlgeschlagen'
  const detail = expired
    ? 'Die Anmeldung gehört zu einer Sitzung, die nicht mehr gilt — etwa nach dem Ende von „Einloggen als“. Melden Sie sich bei der Plattform ab und danach neu an.'
    : description?.trim() ||
      (error === 'access_denied'
        ? 'Ihr Account ist dieser Anwendung nicht zugeordnet.'
        : `Der Anmeldedienst hat die Anmeldung abgelehnt (${error}).`)
  const next = expired
    ? '<p><a href="/api/oidc/signout">Bei der Plattform abmelden</a></p>'
    : '<p>Bitten Sie eine Administratorin oder einen Administrator Ihrer Organisation, Ihren Account für diese Anwendung freizuschalten.</p>\n  <p><a href="/">Zur Startseite</a></p>'
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(headline)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: system-ui, -apple-system, sans-serif; background: #f6f5f2; color: #1a1a1a; }
  main { max-width: 32rem; padding: 2rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  p { margin: 0 0 1rem; line-height: 1.5; }
  small { color: #666; }
  a { color: #8a7648; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(headline)}</h1>
  <p>${escapeHtml(detail)}</p>
  ${next}
  <p><small>Fehlercode: ${escapeHtml(error)}</small></p>
</main>
</body>
</html>
`
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
