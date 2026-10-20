'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/tokens'

export async function serverSignOut(): Promise<void> {
  const store = await cookies()
  store.delete(ACCESS_COOKIE)
  store.delete(REFRESH_COOKIE)
  redirect('/login')
}
