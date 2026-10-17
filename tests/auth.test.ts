import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleApiRequest } from '@/lib/api/router'
import { sessionCookieHeader, signAccessToken } from './helpers/tokens'
import { TEST_PASSWORD, apiRequest, readData, setupTestDb, type TestContext } from './helpers/db'

let ctx: TestContext

beforeAll(async () => {
  process.env.AUTH_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing'
  ctx = await setupTestDb()
})

afterAll(async () => {
  delete process.env.AUTH_SECRET
})

const post = (path: string, body: unknown, token?: string) =>
  handleApiRequest(apiRequest('POST', path, { body, token }), path.split('/'))

const get = (path: string, token?: string) =>
  handleApiRequest(apiRequest('GET', path, { token }), path.split('/'))

describe('registration and login', () => {
  it('registers a member, issues tokens and exposes a dev verification token', async () => {
    const response = await post('auth/register', {
      email: 'newbie@test.dev',
      password: 'Str0ngPass1',
      firstName: 'New',
      lastName: 'Bie',
      acceptWaiver: true,
    })
    expect(response.status).toBe(201)
    const data = await readData<{
      user: { id: string; role: string }
      accessToken: string
      refreshToken: string
      verificationToken?: string
    }>(response)
    expect(data.user.role).toBe('MEMBER')
    expect(data.accessToken.split('.')).toHaveLength(3)
    expect(data.verificationToken).toBeTruthy()
  })

  it('rejects a duplicate email with a 409', async () => {
    const response = await post('auth/register', {
      email: 'member@test.dev',
      password: 'Str0ngPass1',
      firstName: 'Copy',
      lastName: 'Cat',
    })
    expect(response.status).toBe(409)
  })

  it('logs in by email and by phone, and rejects a bad password', async () => {
    const ok = await post('auth/login', { identifier: 'member@test.dev', password: TEST_PASSWORD })
    expect(ok.status).toBe(200)

    const byPhone = await post('auth/login', { identifier: '+15550001', password: TEST_PASSWORD })
    expect(byPhone.status).toBe(200)

    const bad = await post('auth/login', { identifier: 'member@test.dev', password: 'wrong-password' })
    expect(bad.status).toBe(401)
  })

  it('locks an account after repeated failures', async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      await post('auth/login', { identifier: 'lapsed@test.dev', password: 'nope-nope' })
    }
    const locked = await post('auth/login', { identifier: 'lapsed@test.dev', password: TEST_PASSWORD })
    expect(locked.status).toBe(429)
  })

  it('verifies an email address with a token', async () => {
    const registered = await post('auth/register', {
      email: 'verify-me@test.dev',
      password: 'Str0ngPass1',
      firstName: 'Ver',
      lastName: 'Ify',
    })
    const data = await readData<{ verificationToken: string }>(registered)
    const verified = await post('auth/verify-email', { token: data.verificationToken })
    expect(verified.status).toBe(200)
    const payload = await readData<{ verifiedAt: string }>(verified)
    expect(payload.verifiedAt).toBeTruthy()
  })

  it('resets a password and revokes existing sessions', async () => {
    const login = await post('auth/login', { identifier: 'pack@test.dev', password: TEST_PASSWORD })
    const loginData = await readData<{ accessToken: string }>(login)

    const forgot = await post('auth/forgot-password', { email: 'pack@test.dev' })
    const forgotData = await readData<{ resetToken: string }>(forgot)

    const reset = await post('auth/reset-password', { token: forgotData.resetToken, password: 'BrandNew1Pass' })
    expect(reset.status).toBe(200)

    // The old access token belonged to a session that the reset killed.
    const sessions = await get('auth/sessions', loginData.accessToken)
    const rows = await readData<{ revokedAt: string | null }[]>(sessions)
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true)

    // Put the password back so other tests are unaffected.
    const forgotAgain = await post('auth/forgot-password', { email: 'pack@test.dev' })
    const again = await readData<{ resetToken: string }>(forgotAgain)
    await post('auth/reset-password', { token: again.resetToken, password: TEST_PASSWORD })
  })
})

describe('authorization', () => {
  it('requires a token for protected routes', async () => {
    const response = await get('members')
    expect(response.status).toBe(401)
  })

  it('blocks members from staff-only endpoints', async () => {
    const token = await signAccessToken(ctx.fixtures.users.member)
    const response = await get('members', token)
    expect(response.status).toBe(403)
  })

  it('lets front desk read members but not settings', async () => {
    const staffToken = await signAccessToken(ctx.fixtures.users.staff)
    expect((await get('members', staffToken)).status).toBe(200)
    expect((await get('settings', staffToken)).status).toBe(403)
  })

  it('lets a manager read settings but not change them, and admin change them', async () => {
    const managerToken = await signAccessToken(ctx.fixtures.users.manager)
    const adminToken = await signAccessToken(ctx.fixtures.users.admin)

    expect((await get('settings', managerToken)).status).toBe(200)
    const patch = await handleApiRequest(
      apiRequest('PATCH', 'settings', { body: { section: 'gym', value: { name: 'Nope' } }, token: managerToken }),
      ['settings'],
    )
    expect(patch.status).toBe(403)

    const adminPatch = await handleApiRequest(
      apiRequest('PATCH', 'settings', { body: { section: 'gym', value: { name: 'Ironhouse QA' } }, token: adminToken }),
      ['settings'],
    )
    expect(adminPatch.status).toBe(200)
  })

  it('accepts the session cookie for browser requests', async () => {
    const token = await signAccessToken(ctx.fixtures.users.admin)
    const response = await handleApiRequest(
      apiRequest('GET', 'members', { headers: { cookie: sessionCookieHeader(token) } }),
      ['members'],
    )
    expect(response.status).toBe(200)
  })

  it('answers CORS preflight for the mobile app', async () => {
    const response = await handleApiRequest(
      new Request('http://localhost:3000/api/v1/members', { method: 'OPTIONS' }),
      ['members'],
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns 404 with a helpful message for unknown routes', async () => {
    const response = await get('does/not/exist')
    expect(response.status).toBe(404)
  })
})
