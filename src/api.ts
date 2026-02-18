import type { Attempt, Session } from './types'

export type AuthRole = 'player' | 'admin'
export type LeaderboardRow = { rank: number; userName: string; rate: number }

const TOKEN_KEY = 'flightkoy_token'

function apiBase(): string {
  // Бэкенд siteBack (Node.js). Обязательно укажи VITE_API_BASE в siteA/.env, например:
  // VITE_API_BASE=http://localhost:4000
  return (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
}

async function request<T>(path: string, opts: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const base = apiBase()
  if (!base) throw new Error('API base is not configured (set VITE_API_BASE)')
  const headers = new Headers(opts.headers || {})
  headers.set('Content-Type', 'application/json')
  if (opts.auth) {
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(`${base}${path}`, { ...opts, headers })
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => ({}))) as any
  if (!res.ok) {
    const msg = data?.error ? String(data.error) : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function playerLoginOld(password: string): Promise<{ token: string; userName: string; role: AuthRole }> {
  return await request('/api/auth/player-login-old', { method: 'POST', body: JSON.stringify({ password }) })
}

export async function adminLogin(password: string): Promise<{ token: string; userName: string; role: AuthRole }> {
  return await request('/api/auth/admin-login', { method: 'POST', body: JSON.stringify({ password }) })
}

export async function playerRegister(userName: string, password: string): Promise<{ token: string; userName: string; role: AuthRole }> {
  return await request('/api/auth/player-register', { method: 'POST', body: JSON.stringify({ userName, password }) })
}

export async function getSessions(): Promise<Session[]> {
  const res = await request<{ sessions: Session[] }>('/api/sessions', { method: 'GET', auth: true })
  return res.sessions
}

export async function createSessionApi(session: Omit<Session, 'id'>): Promise<Session> {
  const res = await request<{ session: Session }>('/api/sessions', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(session),
  })
  return res.session
}

export async function deleteSessionApi(id: number): Promise<void> {
  await request(`/api/sessions/${id}`, { method: 'DELETE', auth: true })
}

export async function getLeaderboard(sessionId: number): Promise<LeaderboardRow[]> {
  const res = await request<{ leaderboard: LeaderboardRow[] }>(`/api/sessions/${sessionId}/leaderboard`, { method: 'GET', auth: true })
  return res.leaderboard
}

export async function getAttemptsApi(sessionId: number, userName: string): Promise<Attempt[]> {
  const res = await request<{ attempts: Attempt[] }>(`/api/sessions/${sessionId}/attempts?userName=${encodeURIComponent(userName)}`, {
    method: 'GET',
    auth: true,
  })
  return res.attempts
}

export async function addAttemptApi(sessionId: number, rate: number): Promise<void> {
  await request(`/api/sessions/${sessionId}/attempts`, { method: 'POST', auth: true, body: JSON.stringify({ rate }) })
}

