import { randomBytes } from 'node:crypto'
import type { AuthStrategy } from 'payload'

import { loadAppConfig } from '../../config'
import { OIDC_COOKIE } from './oidc-config'
import { verifySessionCookie } from './oidc-cookie'

/** What the platform knows about a person signing in for the first time. */
export type NewUserContext = {
  /** Role in the current workspace ('admin' | 'member'), null without claims. */
  orgRole: string | null
  /** Role on the platform itself, null without claims. */
  platformRole: string | null
  email: string
  /** True when this account is the first in the instance. */
  isFirstUser: boolean
}

/** Maps the platform's view of a person onto one of this app's own roles. */
export type RoleForNewUser = (ctx: NewUserContext) => string

/**
 * The role a newly created account receives.
 *
 * Without a callback this is exactly what it always was: the first account
 * administers, everyone after it gets RFLGD_DEFAULT_USER_ROLE. With a
 * callback the decision belongs entirely to the app, `isFirstUser` included —
 * which is why it is in the context. An app that forgets that branch can end
 * up with an instance that has no administrator.
 *
 * The return value is not checked. Which roles exist is the app's knowledge;
 * an unknown value is rejected by Payload against the field configuration and
 * the account is not created. That is the same path on which this package's
 * own default 'user' once locked instances out.
 */
export function resolveNewUserRole(
  ctx: NewUserContext,
  roleForNewUser?: RoleForNewUser,
): string {
  if (roleForNewUser) return roleForNewUser(ctx)
  return ctx.isFirstUser ? 'admin' : loadAppConfig().defaultRole
}

/**
 * Payload auth strategy for the platform's single sign-on.
 *
 * Creates an account on first sign-in when none exists for the address. The
 * role it gets is `resolveNewUserRole`'s decision — see there.
 */
export function createOidcStrategy(options?: {
  roleForNewUser?: RoleForNewUser
}): AuthStrategy {
  return {
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
        const isFirstUser =
          (await payload.count({ collection: 'users', overrideAccess: true })).totalDocs === 0
        const role = resolveNewUserRole(
          {
            orgRole: session.orgRole ?? null,
            platformRole: session.platformRole ?? null,
            email: session.email,
            isFirstUser,
          },
          options?.roleForNewUser,
        )
        user = await payload.create({
          collection: 'users',
          data: {
            email: session.email,
            password: randomBytes(32).toString('hex'),
            // `role` comes from the environment or the app and is therefore a
            // `string`. The host application narrows `users.role` to the
            // options of its own collection — this package cannot know that
            // type. The value is checked by Payload against the field
            // configuration on write; an unknown one is rejected there.
            role: role as never,
          },
          overrideAccess: true,
        })
      }

      return { user: { ...user, collection: 'users' } }
    },
  }
}

/**
 * The strategy without options — the export every consumer used before this
 * package learned about role translation. Kept so nothing has to change.
 */
export const nextauthStrategy: AuthStrategy = createOidcStrategy()
