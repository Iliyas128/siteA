import { useEffect, useMemo, useRef, useState } from 'react'
import type { Attempt, Session } from '../types'
import {
  addAttemptApi,
  adminLogin,
  clearToken,
  createSessionApi,
  decodeJwtPayload,
  deleteSessionApi,
  getAttemptsApi,
  getLeaderboard,
  getSessions,
  getToken,
  playerLoginOld,
  playerRegister,
  setToken,
  type LeaderboardRow,
} from '../api'

function formatSessionDate(s: Session): string {
  const [y, m, d] = s.startDate.split('-')
  return `${d}.${m}.${y}`
}

function formatAttemptDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

type View = 'selector' | 'sessions' | 'sessionDetail' | 'siteG'
type Modal = null | 'oldPassword' | 'newGamer' | 'adminPassword' | 'details' | 'createSession'

const PATH_SELECTOR = '/'
const PATH_SESSIONS = '/sessions'

function getRouteFromPathname(pathname: string): { view: View; sessionId: number | null } {
  const normalized = pathname.replace(/\/$/, '') || '/'
  if (normalized === PATH_SELECTOR) return { view: 'selector', sessionId: null }
  const sessionsMatch = normalized.match(/^\/sessions\/(\d+)$/)
  if (sessionsMatch) return { view: 'sessionDetail', sessionId: parseInt(sessionsMatch[1], 10) }
  if (normalized === PATH_SESSIONS) return { view: 'sessions', sessionId: null }
  return { view: 'selector', sessionId: null }
}

function MainSelector() {
  const [view, setView] = useState<View>('selector')
  const [user, setUser] = useState<{ userName: string; isAdmin: boolean } | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const [detailsForUser, setDetailsForUser] = useState<string | null>(null)
  const [siteGReturnSessionId, setSiteGReturnSessionId] = useState<number | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [leaderboard, setLeaderboardState] = useState<LeaderboardRow[]>([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)

  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [newGamerUserName, setNewGamerUserName] = useState('')
  const [newGamerPassword, setNewGamerPassword] = useState('')
  const [newGamerError, setNewGamerError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [createSessionStartDate, setCreateSessionStartDate] = useState('')
  const [createSessionStartTime, setCreateSessionStartTime] = useState('12:00')
  const [createSessionDescription, setCreateSessionDescription] = useState('')
  const [createSessionError, setCreateSessionError] = useState('')

  // Защита от двойного сохранения попытки при возврате с Сайта Г (React Strict Mode вызывает effect дважды)
  const processedReturnFromSiteGRef = useRef(false)

  const isAdmin = user?.isAdmin ?? false
  const allSessions = useMemo(() => {
    const copy = [...sessions]
    // newest first
    copy.sort((a, b) => new Date(b.startDate + 'T' + b.startTime).getTime() - new Date(a.startDate + 'T' + a.startTime).getTime())
    return copy
  }, [sessions])

  const loadSessions = async () => {
    setSessionsLoading(true)
    try {
      const list = await getSessions()
      setSessions(list)
    } finally {
      setSessionsLoading(false)
    }
  }

  // Синхронизация с URL: при загрузке и по кнопке «Назад» показываем страницу по пути
  useEffect(() => {
    const syncFromUrl = () => {
      const { view: routeView, sessionId } = getRouteFromPathname(window.location.pathname)
      setSelectedSessionId(sessionId)
      setView(routeView)
    }
    syncFromUrl()
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])

  // При загрузке: если есть токен — восстанавливаем пользователя; если при этом путь «/» — переходим на /sessions
  useEffect(() => {
    const token = getToken()
    if (!token) return
    const payload = decodeJwtPayload(token)
    if (payload) {
      setUser({ userName: payload.sub, isAdmin: payload.role === 'admin' })
      const path = window.location.pathname.replace(/\/$/, '') || '/'
      if (path === PATH_SELECTOR) {
        window.history.replaceState({}, '', PATH_SESSIONS)
        setView('sessions')
      }
    } else {
      clearToken()
    }
  }, [])

  // Возврат с Сайта Г: в URL приходят rate, sessionId, userName — сохраняем попытку один раз и открываем детали сессии
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const rate = params.get('rate')
    const sessionIdParam = params.get('sessionId')
    const userNameParam = params.get('userName')
    if (rate == null || sessionIdParam == null) return
    const r = parseInt(rate, 10)
    const sid = parseInt(sessionIdParam, 10)
    if (Number.isNaN(r) || r < 1 || r > 100 || Number.isNaN(sid)) return
    if (processedReturnFromSiteGRef.current) return
    processedReturnFromSiteGRef.current = true

    const run = async () => {
      const token = getToken()
      if (token) {
        try {
          await addAttemptApi(sid, r)
        } catch {
          // если не удалось сохранить — всё равно продолжим отображение
        }
      }

      if (userNameParam) setUser({ userName: decodeURIComponent(userNameParam), isAdmin: false })
      setSelectedSessionId(sid)
      setView('sessionDetail')
      if (token) await loadSessions()

      window.history.replaceState({}, '', window.location.pathname + window.location.hash)
    }
    void run()
  }, [])

  // При входе в детали сессии — подгружаем лидерборд
  useEffect(() => {
    const run = async () => {
      if (view !== 'sessionDetail' || !selectedSessionId || !getToken()) return
      setLeaderboardLoading(true)
      try {
        const rows = await getLeaderboard(selectedSessionId)
        setLeaderboardState(rows)
      } finally {
        setLeaderboardLoading(false)
      }
    }
    void run()
  }, [view, selectedSessionId])

  // Если токен есть и мы на списке сессий или на странице сессии — подгрузим сессии при необходимости
  useEffect(() => {
    if (view !== 'sessions' && view !== 'sessionDetail') return
    if (!getToken()) return
    if (sessionsLoading) return
    if (sessions.length > 0) return
    void loadSessions()
  }, [view, sessions.length, sessionsLoading])

  const handleOldGamerClick = () => {
    setPasswordInput('')
    setPasswordError('')
    setModal('oldPassword')
  }

  const handleOldPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthLoading(true)
    try {
      const res = await playerLoginOld(passwordInput)
      setToken(res.token)
      setUser({ userName: res.userName, isAdmin: false })
      setModal(null)
      window.history.replaceState({}, '', PATH_SESSIONS)
      setView('sessions')
      await loadSessions()
    } catch {
      setPasswordError('Неверный пароль')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleNewGamerClick = () => {
    setNewGamerUserName('')
    setNewGamerPassword('')
    setNewGamerError('')
    setModal('newGamer')
  }

  const handleNewGamerSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGamerUserName.trim() || !newGamerPassword.trim()) {
      setNewGamerError('Введите имя и пароль')
      return
    }
    setAuthLoading(true)
    try {
      const res = await playerRegister(newGamerUserName.trim(), newGamerPassword.trim())
      setToken(res.token)
      setUser({ userName: res.userName, isAdmin: false })
      setModal(null)
      window.history.replaceState({}, '', PATH_SESSIONS)
      setView('sessions')
      await loadSessions()
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : ''
      setNewGamerError(msg === 'username_taken' ? 'Такой UserName уже занят' : 'Ошибка регистрации')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleAdminClick = () => {
    setPasswordInput('')
    setPasswordError('')
    setModal('adminPassword')
  }

  const handleAdminPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthLoading(true)
    try {
      const res = await adminLogin(passwordInput)
      setToken(res.token)
      setUser({ userName: res.userName, isAdmin: true })
      setModal(null)
      window.history.replaceState({}, '', PATH_SESSIONS)
      setView('sessions')
      await loadSessions()
    } catch {
      setPasswordError('Неверный пароль')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = () => {
    clearToken()
    setUser(null)
    setSelectedSessionId(null)
    setView('selector')
    setDetailsForUser(null)
    setSessions([])
    setLeaderboardState([])
    window.history.replaceState({}, '', PATH_SELECTOR)
  }

  const handleSelectSession = (id: number) => {
    const session = sessions.find((s) => s.id === id)
    if (!session) return
    if (isAdmin) {
      setSelectedSessionId(id)
      setView('sessionDetail')
      window.history.pushState({}, '', `${PATH_SESSIONS}/${id}`)
      return
    }
    const start = new Date(session.startDate + 'T' + session.startTime).getTime()
    if (start > Date.now()) {
      setSelectedSessionId(id)
      setView('sessionDetail')
      window.history.pushState({}, '', `${PATH_SESSIONS}/${id}`)
    }
  }

  const handleBackToSessions = () => {
    setSelectedSessionId(null)
    setDetailsForUser(null)
    setView('sessions')
    window.history.pushState({}, '', PATH_SESSIONS)
  }

  const handleDetails = (forUser?: string) => {
    setDetailsForUser(forUser ?? user?.userName ?? null)
    setModal('details')
  }

  const handlePassQuest = () => {
    if (!selectedSessionId || !user) return
    const siteGUrl = import.meta.env.VITE_SITEG_URL
    if (siteGUrl) {
      const returnBase = window.location.origin + window.location.pathname
      const url = `${siteGUrl}?sessionId=${selectedSessionId}&userName=${encodeURIComponent(user.userName)}&returnBase=${encodeURIComponent(returnBase)}`
      window.location.href = url
      return
    }
    setSiteGReturnSessionId(selectedSessionId)
    setView('siteG')
  }

  const handleSiteGComplete = async (rate: number) => {
    if (!siteGReturnSessionId || !user) return
    try {
      await addAttemptApi(siteGReturnSessionId, rate)
    } catch {
      // noop
    }
    setSelectedSessionId(siteGReturnSessionId)
    setSiteGReturnSessionId(null)
    setView('sessionDetail')
    // обновим лидерборд
    if (getToken()) {
      setLeaderboardLoading(true)
      try {
        const rows = await getLeaderboard(siteGReturnSessionId)
        setLeaderboardState(rows)
      } finally {
        setLeaderboardLoading(false)
      }
    }
  }

  const handleOpenCreateSession = () => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    setCreateSessionStartDate(d.toISOString().slice(0, 10))
    setCreateSessionStartTime('12:00')
    setCreateSessionDescription('Новая сессия')
    setCreateSessionError('')
    setModal('createSession')
  }

  const handleCreateSessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createSessionStartDate.trim() || !createSessionStartTime.trim()) {
      setCreateSessionError('Укажите дату и время начала')
      return
    }
    const ts = Date.parse(`${createSessionStartDate}T${createSessionStartTime}:00`)
    if (Number.isNaN(ts)) {
      setCreateSessionError('Некорректные дата или время')
      return
    }
    setCreateSessionError('')
    try {
      await createSessionApi({
        startDate: createSessionStartDate,
        startTime: createSessionStartTime,
        description: createSessionDescription.trim() || 'Новая сессия',
      })
      setModal(null)
      await loadSessions()
    } catch {
      setCreateSessionError('Не удалось создать сессию')
    }
  }

  const handleDeleteSession = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isAdmin) return
    if (confirm('Удалить сессию?')) {
      void (async () => {
        try {
          await deleteSessionApi(id)
          await loadSessions()
          if (selectedSessionId === id) {
            setSelectedSessionId(null)
            setView('sessions')
            window.history.pushState({}, '', PATH_SESSIONS)
          }
        } catch {
          // noop
        }
      })()
    }
  }

  // ————— Экран выбора: Old gamer / New gamer / Admin —————
  if (view === 'selector') {
    return (
      <>
        <div className="h-screen flex items-center justify-center">
          <nav className="flex flex-col border border-gray-300 rounded-lg gap-5 p-6 bg-white shadow-md">
            <button
              type="button"
              onClick={handleOldGamerClick}
              className="bg-blue-400 text-black font-bold w-40 py-2 rounded hover:bg-blue-500"
            >
              Old gamer
            </button>
            <button
              type="button"
              onClick={handleNewGamerClick}
              className="bg-blue-400 text-black font-bold w-40 py-2 rounded hover:bg-blue-500"
            >
              New gamer
            </button>
            <button
              type="button"
              onClick={handleAdminClick}
              className="bg-blue-400 text-black font-bold w-40 py-2 rounded hover:bg-blue-500"
            >
              Admin
            </button>
          </nav>
        </div>

        {modal === 'oldPassword' && (
          <PasswordModal
            title="Введите пароль (Old gamer)"
            value={passwordInput}
            onChange={setPasswordInput}
            error={passwordError}
            onErrorClear={() => setPasswordError('')}
            onSubmit={handleOldPasswordSubmit}
            onClose={() => setModal(null)}
            loading={authLoading}
          />
        )}
        {modal === 'newGamer' && (
          <NewGamerModal
            userName={newGamerUserName}
            password={newGamerPassword}
            onUserNameChange={setNewGamerUserName}
            onPasswordChange={setNewGamerPassword}
            error={newGamerError}
            onSubmit={handleNewGamerSubmit}
            onClose={() => setModal(null)}
            loading={authLoading}
          />
        )}
        {modal === 'adminPassword' && (
          <PasswordModal
            title="Введите пароль (Admin)"
            value={passwordInput}
            onChange={setPasswordInput}
            error={passwordError}
            onErrorClear={() => setPasswordError('')}
            onSubmit={handleAdminPasswordSubmit}
            onClose={() => setModal(null)}
            loading={authLoading}
          />
        )}
      </>
    )
  }

  // ————— Страница «Сайт Г»: случайное число 1–100, затем возврат —————
  if (view === 'siteG') {
    return (
      <SiteGPage
        onComplete={handleSiteGComplete}
        onCancel={() => {
          setView('sessionDetail')
          setSiteGReturnSessionId(null)
        }}
      />
    )
  }

  // ————— Список сессий (игрок или админ) —————
  if (view === 'sessions') {
    return (
      <>
        <div className="h-screen flex flex-col bg-gray-50">
          <header className="shrink-0 border-b rounded border-gray-200 bg-white px-4 py-3 flex justify-between items-center">
            <span className="text-sm text-gray-600">
              {isAdmin ? 'Админ' : 'Игрок'}: <strong>{user?.userName}</strong>
            </span>
            <button type="button" onClick={handleLogout} className="text-sm text-blue-600 hover:underline" title="Выйти из аккаунта">
              Выйти из аккаунта
            </button>
          </header>
          <main className="flex-1 min-h-0 p-4 flex flex-col overflow-hidden">
            {isAdmin && (
              <div className="shrink-0 mb-4">
                <button
                  type="button"
                  onClick={handleOpenCreateSession}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Создать сессию
                </button>
              </div>
            )}
            <div className="flex-1 min-h-0 bg-white rounded-lg border border-gray-200 shadow-sm overflow-auto w-full">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                  <tr >
                    <th className="py-3 px-4 font-semibold text-gray-700">№ сессии</th>
                    <th className="py-3 px-4 font-semibold text-gray-700">Дата начала</th>
                    <th className="py-3 px-4 font-semibold text-gray-700">Время начала</th>
                    <th className="py-3 px-4 font-semibold text-gray-700">Описание</th>
                    {isAdmin && <th className="w-24" />}
                  </tr>
                </thead>
                <tbody>
                  {sessionsLoading ? (
                    <tr>
                      <td className="py-3 px-4 text-gray-500" colSpan={isAdmin ? 5 : 4}>
                        Загрузка...
                      </td>
                    </tr>
                  ) : allSessions.length === 0 ? (
                    <tr>
                      <td className="py-3 px-4 text-gray-500" colSpan={isAdmin ? 5 : 4}>
                        Сессий пока нет
                      </td>
                    </tr>
                  ) : (
                    allSessions.map((s) => {
                      const start = new Date(s.startDate + 'T' + s.startTime).getTime()
                      const isUpcoming = start > Date.now()
                      const canSelect = isAdmin || isUpcoming
                      return (
                        <tr
                          key={s.id}
                          onClick={() => canSelect && handleSelectSession(s.id)}
                          className={`border-b border-gray-100 ${canSelect ? 'hover:bg-gray-50 cursor-pointer' : 'opacity-60'}`}
                        >
                          <td className="py-3 px-4">{s.id}</td>
                          <td className="py-3 px-4">{formatSessionDate(s)}</td>
                          <td className="py-3 px-4">{s.startTime}</td>
                          <td className="py-3 px-4">{s.description}</td>
                          {isAdmin && (
                            <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteSession(s.id, e)}
                                className="text-red-600 text-sm hover:underline"
                              >
                                Удалить
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </main>
        </div>

        {modal === 'createSession' && (
          <CreateSessionModal
            startDate={createSessionStartDate}
            startTime={createSessionStartTime}
            description={createSessionDescription}
            onStartDateChange={setCreateSessionStartDate}
            onStartTimeChange={setCreateSessionStartTime}
            onDescriptionChange={setCreateSessionDescription}
            error={createSessionError}
            onErrorClear={() => setCreateSessionError('')}
            onSubmit={handleCreateSessionSubmit}
            onClose={() => setModal(null)}
          />
        )}
      </>
    )
  }

  // ————— Детали сессии: инфо, лидерборд, персональные результаты, кнопки —————
  if (view === 'sessionDetail' && selectedSessionId) {
    const session = sessions.find((s) => s.id === selectedSessionId)
    if (!session && sessions.length > 0) {
      setSelectedSessionId(null)
      setDetailsForUser(null)
      setView('sessions')
      window.history.pushState({}, '', PATH_SESSIONS)
      return null
    }
    if (!session) {
      return (
        <div className="h-screen flex items-center justify-center bg-gray-50">
          <p className="text-gray-500">Загрузка сессии...</p>
        </div>
      )
    }
    const currentUser = user?.userName
    const me = currentUser ? leaderboard.find((r) => r.userName === currentUser) : undefined
    const myRate = me?.rate ?? 0
    const myRank = me?.rank ?? (currentUser ? leaderboard.length + 1 : 0)

    return (
      <>
        <div className="h-screen flex flex-col bg-gray-50">
          <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 flex justify-between items-center">
            <button type="button" onClick={handleBackToSessions} className="text-blue-600 hover:underline">
              ← К списку сессий
            </button>
            <div className="flex items-center gap-4">
              <span className="font-medium">{user?.userName}</span>
              <button type="button" onClick={handleLogout} className="text-sm text-blue-600 hover:underline" title="Выйти из аккаунта">
                Выйти из аккаунта
              </button>
            </div>
          </header>

          <main className="flex-1 min-h-0 p-4 overflow-hidden flex gap-4">
            {/* Левая часть: инфо сессии + лидерборд — на всю ширину и высоту */}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-4">
              <div className="shrink-0 bg-white rounded-lg border border-gray-200 p-4 shadow-sm w-full">
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <span className="text-gray-500 text-sm">№ сессии</span>
                    <p className="font-semibold">{session.id}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-sm">Дата начала</span>
                    <p className="font-semibold">{formatSessionDate(session)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-sm">Время начала</span>
                    <p className="font-semibold">{session.startTime}</p>
                  </div>
                </div>
                <div>
                  <span className="text-gray-500 text-sm block mb-1">Текстовое описание сессии</span>
                  <p className="text-gray-800">{session.description}</p>
                </div>
              </div>

              <div className="flex-1 min-h-0 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col w-full">
                <p className="shrink-0 text-xs text-gray-500 px-4 pt-2">
                  Список игроков, прошедших квесты по данной сессии. Список можно скроллить.
                </p>
                <div className="overflow-auto flex-1 min-h-0">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr>
                        <th className="py-2 px-4 font-semibold text-gray-700">№</th>
                        <th className="py-2 px-4 font-semibold text-gray-700">UserName</th>
                        <th className="py-2 px-4 font-semibold text-gray-700">Rate</th>
                        {isAdmin && <th className="w-24" />}
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboardLoading ? (
                        <tr>
                          <td className="py-3 px-4 text-gray-500" colSpan={isAdmin ? 4 : 3}>
                            Загрузка...
                          </td>
                        </tr>
                      ) : leaderboard.length === 0 ? (
                        <tr>
                          <td className="py-3 px-4 text-gray-500" colSpan={isAdmin ? 4 : 3}>
                            Пока нет попыток по этой сессии
                          </td>
                        </tr>
                      ) : (
                        leaderboard.map((r) => (
                          <tr key={r.userName} className="border-b border-gray-100">
                            <td className="py-2 px-4">{r.rank}</td>
                            <td className="py-2 px-4">{r.userName}</td>
                            <td className="py-2 px-4">{r.rate}</td>
                            {isAdmin && (
                              <td className="py-2 px-4">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDetailsForUser(r.userName)
                                    setModal('details')
                                  }}
                                  className="text-blue-600 text-sm hover:underline"
                                >
                                  Подробности
                                </button>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Правая часть: персональные результаты + кнопки (для игрока) — на всю высоту */}
            {currentUser && !isAdmin && (
              <div className="w-72 shrink-0 flex flex-col min-h-0">
                <div className="flex-1 min-h-0 bg-white rounded-lg border border-gray-200 p-4 shadow-sm flex flex-col w-full">
                  <p className="text-xs text-gray-500 mb-2">Персональные результаты {currentUser}</p>
                  <p className="font-medium">{currentUser}</p>
                  <p className="text-sm mt-2">№ = {myRank}</p>
                  <p className="text-sm">Rate = {myRate}</p>
                </div>
                <div className="shrink-0 flex flex-col gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => handleDetails()}
                    className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Подробности
                  </button>
                  <button
                    type="button"
                    onClick={handlePassQuest}
                    className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Пройти квест
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>

        {/* Модалка «Подробности»: все попытки игрока по сессии, лучшая — зелёная */}
        {modal === 'details' && detailsForUser && (
          <DetailsModal
            sessionId={selectedSessionId!}
            userName={detailsForUser}
            onClose={() => {
              setModal(null)
              setDetailsForUser(null)
            }}
          />
        )}
      </>
    )
  }

  return null
}

// ————— Спиннер загрузки —————
function LoaderSpinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500 ${className}`}
      role="status"
      aria-label="Загрузка"
    />
  )
}

// ————— Модальное окно пароля —————
function PasswordModal({
  title,
  value,
  onChange,
  error,
  onErrorClear,
  onSubmit,
  onClose,
  loading = false,
}: {
  title: string
  value: string
  onChange: (v: string) => void
  error: string
  onErrorClear: () => void
  onSubmit: (e: React.FormEvent) => void
  onClose: () => void
  loading?: boolean
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-black hover:bg-gray-100 rounded text-xl leading-none disabled:opacity-50"
            title="Закрыть"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-6">
          <input
            type="password"
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              onErrorClear()
            }}
            disabled={loading}
            className="w-full border border-gray-300 rounded px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60 disabled:bg-gray-50"
            placeholder="Пароль"
            autoFocus
          />
          {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
          <div className="flex gap-2 justify-end mt-4">
            <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50">
              Отмена
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-70 flex items-center gap-2 min-w-[5rem] justify-center">
              {loading ? <LoaderSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : 'Войти'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ————— Модальное окно регистрации (New gamer) —————
function NewGamerModal({
  userName,
  password,
  onUserNameChange,
  onPasswordChange,
  error,
  onSubmit,
  onClose,
  loading = false,
}: {
  userName: string
  password: string
  onUserNameChange: (v: string) => void
  onPasswordChange: (v: string) => void
  error: string
  onSubmit: (e: React.FormEvent) => void
  onClose: () => void
  loading?: boolean
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-bold">Регистрация (New gamer)</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-black hover:bg-gray-100 rounded text-xl leading-none disabled:opacity-50"
            title="Закрыть"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-6">
          <input
            type="text"
            value={userName}
            onChange={(e) => onUserNameChange(e.target.value)}
            disabled={loading}
            className="w-full border border-gray-300 rounded px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60 disabled:bg-gray-50"
            placeholder="UserName"
            autoFocus
          />
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            disabled={loading}
            className="w-full border border-gray-300 rounded px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60 disabled:bg-gray-50"
            placeholder="Пароль"
          />
          {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
          <div className="flex gap-2 justify-end mt-4">
            <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50">
              Отмена
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-70 flex items-center gap-2 min-w-[8rem] justify-center">
              {loading ? <LoaderSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : 'Зарегистрироваться'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ————— Модальное окно создания сессии (админ): дата, время, описание —————
function CreateSessionModal({
  startDate,
  startTime,
  description,
  onStartDateChange,
  onStartTimeChange,
  onDescriptionChange,
  error,
  onErrorClear,
  onSubmit,
  onClose,
}: {
  startDate: string
  startTime: string
  description: string
  onStartDateChange: (v: string) => void
  onStartTimeChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  error: string
  onErrorClear: () => void
  onSubmit: (e: React.FormEvent) => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-bold">Создать сессию</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-black hover:bg-gray-100 rounded text-xl leading-none"
            title="Закрыть"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-6">
          <label className="block text-sm text-gray-600 mb-1">Дата начала</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              onStartDateChange(e.target.value)
              onErrorClear()
            }}
            className="w-full border border-gray-300 rounded px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <label className="block text-sm text-gray-600 mb-1">Время начала</label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => {
              onStartTimeChange(e.target.value)
              onErrorClear()
            }}
            className="w-full border border-gray-300 rounded px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <label className="block text-sm text-gray-600 mb-1">Описание</label>
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            placeholder="Текстовое описание сессии"
          />
          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100">
              Отмена
            </button>
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
              Создать
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ————— Модальное окно «Подробности»: попытки игрока, лучшая — зелёная —————
function DetailsModal({
  sessionId,
  userName,
  onClose,
}: {
  sessionId: number
  userName: string
  onClose: () => void
}) {
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true)
      try {
        const list = await getAttemptsApi(sessionId, userName)
        if (alive) setAttempts(list)
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [sessionId, userName])

  // Убираем дубликаты (одинаковые дата+время и rate), оставшиеся от двойного сохранения
  const uniqueAttempts = useMemo(() => {
    const seen = new Set<string>()
    return attempts.filter((a) => {
      const key = `${a.dateTime}|${a.rate}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [attempts])

  const bestRate = uniqueAttempts.length ? Math.max(...uniqueAttempts.map((a) => a.rate)) : 0
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-lg font-bold">Подробности: {userName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-black hover:bg-gray-100 rounded text-xl leading-none"
            title="Закрыть"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <div className="overflow-auto p-4">
          {loading ? (
            <p className="text-gray-500">Загрузка...</p>
          ) : uniqueAttempts.length === 0 ? (
            <p className="text-gray-500">Попыток пока нет</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="py-2">Дата / время</th>
                  <th className="py-2">Результат (Rate)</th>
                </tr>
              </thead>
              <tbody>
                {uniqueAttempts.map((a) => (
                  <tr
                    key={a.id}
                    className={`border-b ${a.rate === bestRate && bestRate > 0 ? 'bg-green-100' : ''}`}
                  >
                    <td className="py-2">{formatAttemptDateTime(a.dateTime)}</td>
                    <td className="py-2 font-medium">{a.rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ————— Страница «Сайт Г»: случайное число 1–100, кнопка вернуться —————
function SiteGPage({ onComplete, onCancel }: { onComplete: (rate: number) => void; onCancel: () => void }) {
  const [rate, setRate] = useState<number | null>(null)
  const generate = () => {
    const value = Math.floor(Math.random() * 100) + 1
    setRate(value)
  }
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 gap-6 p-4">
      <h1 className="text-2xl font-bold">Сайт Г</h1>
      <p className="text-gray-600">Это число будет записано как Rate данной попытки.</p>
      {rate === null ? (
        <button
          type="button"
          onClick={generate}
          className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium"
        >
          Получить число (1–100)
        </button>
      ) : (
        <>
          <p className="text-4xl font-bold text-blue-600">Rate = {rate}</p>
          <button
            type="button"
            onClick={() => onComplete(rate)}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Вернуться к сессии
          </button>
        </>
      )}
      <button type="button" onClick={onCancel} className="text-gray-500 hover:underline">
        Отмена (назад к сессии без сохранения)
      </button>
    </div>
  )
}

export default MainSelector
