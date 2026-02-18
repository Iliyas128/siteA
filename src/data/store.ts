import type { Session, Attempt, Player } from '../types'

let nextSessionId = 10
let nextAttemptId = 100

const sessions: Session[] = [
  { id: 1, startDate: '2025-03-01', startTime: '14:30', description: 'Текстовое описание сессии 1' },
  { id: 2, startDate: '2025-03-02', startTime: '10:00', description: 'Текстовое описание сессии 2' },
  { id: 3, startDate: '2025-02-10', startTime: '18:45', description: 'Прошедшая сессия' },
]

const players: Player[] = [
  { userName: 'Artur_1', password: 'artur', isAdmin: false },
  { userName: 'Antuan', password: 'a', isAdmin: false },
  { userName: 'Maria', password: 'm', isAdmin: false },
  { userName: 'Ivan', password: 'i', isAdmin: false },
  { userName: 'admin', password: 'admin', isAdmin: true },
]

const attempts: Attempt[] = [
  { id: 1, sessionId: 1, userName: 'Antuan', dateTime: '2025-03-01T14:35:00', rate: 98 },
  { id: 2, sessionId: 1, userName: 'Maria', dateTime: '2025-03-01T14:40:00', rate: 81 },
  { id: 3, sessionId: 1, userName: 'Ivan', dateTime: '2025-03-01T14:45:00', rate: 69 },
  { id: 4, sessionId: 1, userName: 'Artur_1', dateTime: '2025-03-01T15:00:00', rate: 78 },
  { id: 5, sessionId: 1, userName: 'Artur_1', dateTime: '2025-03-01T15:10:00', rate: 65 },
  { id: 6, sessionId: 1, userName: 'Artur_1', dateTime: '2025-03-01T15:20:00', rate: 82 },
]

function parseSessionStart(s: Session): number {
  const [y, m, d] = s.startDate.split('-').map(Number)
  const [h, min] = s.startTime.split(':').map(Number)
  return new Date(y, m - 1, d, h, min).getTime()
}

export function getUpcomingSessions(): Session[] {
  const now = Date.now()
  return sessions
    .filter((s) => parseSessionStart(s) > now)
    .sort((a, b) => parseSessionStart(a) - parseSessionStart(b))
}

export function getAllSessions(): Session[] {
  return [...sessions].sort((a, b) => parseSessionStart(b) - parseSessionStart(a))
}

export function getSession(id: number): Session | undefined {
  return sessions.find((s) => s.id === id)
}

export function getLeaderboard(sessionId: number): { rank: number; userName: string; rate: number }[] {
  const byUser = new Map<string, number>()
  for (const a of attempts) {
    if (a.sessionId !== sessionId) continue
    const best = byUser.get(a.userName)
    if (best == null || a.rate > best) byUser.set(a.userName, a.rate)
  }
  const list = Array.from(byUser.entries()).map(([userName, rate]) => ({ userName, rate }))
  list.sort((a, b) => b.rate - a.rate)
  return list.map((item, i) => ({ rank: i + 1, userName: item.userName, rate: item.rate }))
}

export function getAttempts(sessionId: number, userName: string): Attempt[] {
  return attempts
    .filter((a) => a.sessionId === sessionId && a.userName === userName)
    .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
}

export function getBestRate(sessionId: number, userName: string): number {
  const list = getAttempts(sessionId, userName)
  if (list.length === 0) return 0
  return Math.max(...list.map((a) => a.rate))
}

export function getRank(sessionId: number, userName: string): number {
  const leaderboard = getLeaderboard(sessionId)
  const idx = leaderboard.findIndex((r) => r.userName === userName)
  return idx === -1 ? leaderboard.length + 1 : leaderboard[idx].rank
}

export function addAttempt(sessionId: number, userName: string, rate: number): void {
  attempts.push({
    id: nextAttemptId++,
    sessionId,
    userName,
    dateTime: new Date().toISOString(),
    rate,
  })
}

export function createSession(session: Omit<Session, 'id'>): Session {
  const newSession: Session = { ...session, id: nextSessionId++ }
  sessions.push(newSession)
  return newSession
}

export function deleteSession(id: number): void {
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx !== -1) sessions.splice(idx, 1)
  while (attempts.length > 0) {
    const i = attempts.findIndex((a) => a.sessionId === id)
    if (i === -1) break
    attempts.splice(i, 1)
  }
}

export function registerPlayer(userName: string, password: string): boolean {
  if (players.some((p) => p.userName === userName)) return false
  players.push({ userName, password, isAdmin: false })
  return true
}

export function getUsernameByPassword(password: string): string | null {
  const p = players.find((x) => !x.isAdmin && x.password === password.trim())
  return p ? p.userName : null
}

export function getAdminByPassword(password: string): { userName: string } | null {
  const p = players.find((x) => x.isAdmin && x.password === password.trim())
  return p ? { userName: p.userName } : null
}

export function formatSessionDate(s: Session): string {
  const [y, m, d] = s.startDate.split('-')
  return `${d}.${m}.${y}`
}

export function formatAttemptDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}
