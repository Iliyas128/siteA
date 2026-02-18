export type Session = {
  id: number
  startDate: string // YYYY-MM-DD
  startTime: string // HH:mm
  description: string
}

export type Attempt = {
  id: number
  sessionId: number
  userName: string
  dateTime: string // ISO string
  rate: number
}

export type Player = {
  userName: string
  password: string // в моке храним открыто; в проде — хэш
  isAdmin: boolean
}
