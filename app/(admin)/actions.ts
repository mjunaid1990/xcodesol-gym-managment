'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/tokens'

export async function serverSignOut(): Promise<void> {
  const store = await cookies()
  const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)

  // Clear access cookie
  store.set(ACCESS_COOKIE, '', {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
  })
  store.delete(ACCESS_COOKIE)

  // Clear refresh cookie on both root and /api/v1/auth
  store.set(REFRESH_COOKIE, '', {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
  })
  store.set(REFRESH_COOKIE, '', {
    path: '/api/v1/auth',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
  })
  store.delete(REFRESH_COOKIE)

  redirect('/login?signedOut=1')
}
