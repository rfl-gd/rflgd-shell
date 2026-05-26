import { randomBytes } from 'node:crypto'
import type { AuthStrategy } from 'payload'

import { loadAppConfig } from '../../config'
import { OIDC_COOKIE } from './oidc-config'
import { verifySessionCookie } from './oidc-cookie'

export const nextauthStrategy: AuthStrategy = {
  name: 'rflgd-oidc',
  authenticate: async ({ payload, headers }) => {
    const secret = process.env.AUTH_SECRET
    if (!secret) return { user: null }

    const cookieHeader = headers.get('cookie') ?? ''
    const cookieStart = `${OIDC_COOKIE}=`
    const segment = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(cookieStart))
    if (!segment) return { user: null }

    const token = segment.slice(cookieStart.length)
    const session = await verifySessionCookie(secret, token)
    if (!session?.email) return { user: null }

    const existing = await payload.find({
      collection: 'users',
      where: { email: { equals: session.email } },
      limit: 1,
      overrideAccess: true,
    })

    let user = existing.docs[0]
    if (!user) {
      const config = loadAppConfig()
      const isFirst = (await payload.count({ collection: 'users', overrideAccess: true })).totalDocs === 0
      user = await payload.create({
        collection: 'users',
        data: {
          email: session.email,
          password: randomBytes(32).toString('hex'),
          role: isFirst ? 'admin' : config.defaultRole,
        },
        overrideAccess: true,
      })
    }

    return { user: { ...user, collection: 'users' } }
  },
}
