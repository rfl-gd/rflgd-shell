import { NextResponse, type NextRequest } from 'next/server'

const OIDC_COOKIE = 'rflgd-session'

export default function middleware(req: NextRequest): NextResponse | undefined {
  const { pathname, search, origin } = req.nextUrl

  if (pathname.startsWith('/admin/api')) return

  const wantsAdmin = pathname === '/admin' || pathname.startsWith('/admin/')
  if (!wantsAdmin) return

  if (pathname.startsWith('/admin/logout')) {
    return NextResponse.redirect(new URL('/api/oidc/signout', origin))
  }

  if (pathname.startsWith('/admin/login')) {
    const target = '/admin'
    const signinUrl = new URL('/api/oidc/signin', origin)
    signinUrl.searchParams.set('callbackUrl', target)
    return NextResponse.redirect(signinUrl)
  }

  if (req.cookies.get(OIDC_COOKIE)) return

  const target = pathname + search
  const signinUrl = new URL('/api/oidc/signin', origin)
  signinUrl.searchParams.set('callbackUrl', target)
  return NextResponse.redirect(signinUrl)
}

export const config = {
  matcher: ['/admin/:path*'],
}
