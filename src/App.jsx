import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import mcheyneData from './data/mcheyne.json'

const ESV_API_KEY = import.meta.env.VITE_ESV_API_KEY

export default function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [todaysReading, setTodaysReading] = useState(null)
  const [passageTexts, setPassageTexts] = useState({})
  const [readingPassageIndex, setReadingPassageIndex] = useState(null)
  const [readingDirection, setReadingDirection] = useState('next')
  const [touchStartX, setTouchStartX] = useState(null)
  const [isClosingReadingMode, setIsClosingReadingMode] = useState(false)
  const [todaysCompletions, setTodaysCompletions] = useState([])
  const [streak, setStreak] = useState(0)
  const [communityMembers, setCommunityMembers] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [profileUserId, setProfileUserId] = useState(null)

  const getSeasonalFruitEmoji = () => {
    const month = new Date().getMonth() + 1

    if (month >= 3 && month <= 5) return '🥝'
    if (month >= 6 && month <= 8) return '🍉'
    if (month >= 9 && month <= 11) return '🍎'
    return '🍊'
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    supabase.auth.onAuthStateChange((_event, session) => setSession(session))
  }, [])

  useEffect(() => {
    if (!session) {
      return
    }

    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error && error.code !== 'PGRST116') {
          console.error('Error fetching profile', error)
        }
        setDisplayName(data?.display_name || '')
        setProfileUserId(session.user.id)
        setProfileLoaded(true)
      })
  }, [session])

  useEffect(() => {
    const now = new Date()
    const monthNames = ['January','February','March','April','May','June',
      'July','August','September','October','November','December']
    const todayStr = `${monthNames[now.getMonth()]} ${now.getDate()}`
    const entry = mcheyneData.data.find(d => d.date === todayStr)
    setTodaysReading(entry)
  }, [])

  useEffect(() => {
    if (!todaysReading) return

    const keys = ['family1', 'family2', 'secret1', 'secret2']
    keys.forEach(key => {
      const passage = todaysReading[key]
      if (!passage) return

      const params = new URLSearchParams({
        q: passage,
        'include-footnotes': 'false',
        'include-headings': 'true',
        'include-verse-numbers': 'false',
      })

      fetch(`https://api.esv.org/v3/passage/text/?${params}`, {
        headers: { Authorization: `Token ${ESV_API_KEY}` },
      })
        .then(res => res.json())
        .then(data => {
          setPassageTexts(prev => ({ ...prev, [key]: data.passages?.[0] || '' }))
        })
    })
  }, [todaysReading])

  // Fetch today's completions for current user
  const fetchTodaysCompletions = async () => {
    if (!session || !todaysReading) return
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from('completions')
      .select('passage')
      .eq('user_id', session.user.id)
      .eq('reading_date', today)

    if (error) {
      console.error('Error fetching completions', error)
      return
    }
    setTodaysCompletions(data?.map(d => d.passage) || [])
  }

  const fetchCommunityData = async () => {
    if (!session) return

    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id, display_name')

    if (profileError) {
      console.error('Error fetching profiles', profileError)
      return
    }

    const { data: completionRows, error: completionError } = await supabase
      .from('completions')
      .select('user_id, reading_date, passage')

    if (completionError) {
      console.error('Error fetching community completions', completionError)
      return
    }

    const todayKey = new Date().toISOString().slice(0, 10)
    const groupedByUser = {}

    ;(Array.isArray(completionRows) ? completionRows : []).forEach(row => {
      if (!row?.user_id || !row?.reading_date) return
      if (!groupedByUser[row.user_id]) groupedByUser[row.user_id] = {}
      if (!groupedByUser[row.user_id][row.reading_date]) groupedByUser[row.user_id][row.reading_date] = new Set()
      groupedByUser[row.user_id][row.reading_date].add(row.passage)
    })

    const members = (Array.isArray(profileRows) ? profileRows : [])
      .map(profile => {
        const completedToday = groupedByUser[profile.id]?.[todayKey] || new Set()
        return {
          id: profile.id,
          name: profile.display_name || 'Anonymous',
          completedCount: completedToday.size,
          completedAll: completedToday.size >= 4,
        }
      })
      .sort((a, b) => {
        if (a.completedCount === b.completedCount) return a.name.localeCompare(b.name)
        return b.completedCount - a.completedCount
      })

    setCommunityMembers(members)

    const leaderboardData = (Array.isArray(profileRows) ? profileRows : [])
      .map(profile => {
        const userDates = groupedByUser[profile.id] || {}
        let streakCount = 0
        const cursor = new Date()

        while (true) {
          const dateKey = cursor.toISOString().slice(0, 10)
          const uniquePassages = userDates[dateKey]?.size || 0

          if (uniquePassages >= 4) {
            streakCount += 1
            cursor.setDate(cursor.getDate() - 1)
            continue
          }
          break
        }

        return {
          id: profile.id,
          name: profile.display_name || 'Anonymous',
          streak: streakCount,
        }
      })
      .sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name))
      .map((member, index) => ({ ...member, rank: index + 1 }))

    setLeaderboard(leaderboardData)
  }

  useEffect(() => {
    fetchTodaysCompletions()
  }, [session, todaysReading])

  useEffect(() => {
    if (!session) return
    fetchCommunityData()
  }, [session])

  useEffect(() => {
    if (!session) return

    const communityChannel = supabase
      .channel('orchard-community-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'completions' }, () => {
        fetchCommunityData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(communityChannel)
    }
  }, [session])

  // Compute streak: consecutive days with all 4 passages completed
  useEffect(() => {
    if (!session) return
    const computeStreak = async () => {
      // fetch last 60 days of completions for this user
      const since = new Date()
      since.setDate(since.getDate() - 60)
      const sinceStr = since.toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('completions')
        .select('reading_date, passage')
        .eq('user_id', session.user.id)
        .gte('reading_date', sinceStr)
        .order('reading_date', { ascending: false })

      if (error) {
        console.error('Error fetching completions for streak', error)
        return
      }

      // Ensure data is an array
      console.log('computeStreak: raw data', data)
      const rows = Array.isArray(data) ? data : []

      // Group by date (normalize to YYYY-MM-DD)
      const groups = {}
      rows.forEach(row => {
        const dateKey = row && row.reading_date ? new Date(row.reading_date).toISOString().slice(0, 10) : null
        if (!dateKey) return
        if (!groups[dateKey]) groups[dateKey] = new Set()
        groups[dateKey].add(row.passage)
      })

      // Merge local today's completions so toggles update streak immediately
      const todayKey = new Date().toISOString().slice(0, 10)
      if (todaysCompletions && todaysCompletions.length) {
        if (!groups[todayKey]) groups[todayKey] = new Set()
        todaysCompletions.forEach(p => groups[todayKey].add(p))
      }

      

      // Walk backwards from today counting consecutive days with 4 passages
      let count = 0
      const today = new Date()
      while (true) {
        const dStr = today.toISOString().slice(0, 10)
        if (groups[dStr] && groups[dStr].size >= 4) {
          count += 1
          today.setDate(today.getDate() - 1)
          continue
        }
        break
      }
      setStreak(count)
    }
    computeStreak()
  }, [session, todaysCompletions])

  async function handleSignUp() {
    setLoading(true)
    const { error } = await supabase.auth.signUp({ email, password })
    setMessage(error ? error.message : 'Check your email to confirm your account!')
    setLoading(false)
  }

  async function handleLogin() {
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage(error.message)
    setLoading(false)
  }

  async function handleSaveName() {
    const trimmedName = displayName.trim()
    if (!trimmedName) {
      setMessage('Please enter a name for your profile.')
      return
    }

    setLoading(true)
    const { error } = await supabase.from('profiles').upsert({
      id: session.user.id,
      display_name: trimmedName,
    })
    if (!error) setDisplayName(trimmedName)
    setMessage(error ? error.message : 'Name saved!')
    setLoading(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  const passages = todaysReading ? [
    { key: 'family1', label: 'Family 1', passage: todaysReading.family1 },
    { key: 'family2', label: 'Family 2', passage: todaysReading.family2 },
    { key: 'secret1', label: 'Secret 1', passage: todaysReading.secret1 },
    { key: 'secret2', label: 'Secret 2', passage: todaysReading.secret2 },
  ] : []

  useEffect(() => {
    if (readingPassageIndex === null) return

    const handleKeyDown = event => {
      if (event.key === 'Escape') closeReadingMode()
      if (event.key === 'ArrowLeft') moveReadingPassage(-1)
      if (event.key === 'ArrowRight') moveReadingPassage(1)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [readingPassageIndex])

  const openReadingMode = index => {
    if (!passages[index]) return
    setIsClosingReadingMode(false)
    setReadingDirection('next')
    setReadingPassageIndex(index)
  }

  const handlePassageCardClick = index => {
    openReadingMode(index)
  }

  const handlePassageCardKeyDown = (event, index) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handlePassageCardClick(index)
    }
  }

  const closeReadingMode = () => {
    if (isClosingReadingMode) return
    setIsClosingReadingMode(true)
    window.setTimeout(() => {
      setReadingPassageIndex(null)
      setIsClosingReadingMode(false)
    }, 220)
  }

  const moveReadingPassage = direction => {
    if (readingPassageIndex === null) return

    const nextIndex = readingPassageIndex + direction
    if (nextIndex < 0 || nextIndex >= passages.length) {
      closeReadingMode()
      return
    }

    setReadingDirection(direction > 0 ? 'next' : 'previous')
    setReadingPassageIndex(nextIndex)
  }

  const handleReadingTouchStart = event => {
    setTouchStartX(event.touches[0].clientX)
  }

  const handleReadingTouchEnd = event => {
    if (touchStartX === null) return

    const distance = event.changedTouches[0].clientX - touchStartX
    setTouchStartX(null)
    if (Math.abs(distance) < 50) return
    moveReadingPassage(distance < 0 ? 1 : -1)
  }

  const toggleCompletion = async (passage, checked) => {
    if (!session) return
    const today = new Date().toISOString().slice(0, 10)

    if (checked) {
      // add
      setTodaysCompletions(prev => Array.from(new Set([...prev, passage])))
      const { error } = await supabase.from('completions').insert([{ user_id: session.user.id, reading_date: today, passage }])
      if (error) {
        console.error('Insert completion error', error)
      } else {
        await fetchTodaysCompletions()
      }
    } else {
      // remove
      setTodaysCompletions(prev => prev.filter(p => p !== passage))
      const { error } = await supabase.from('completions').delete().match({ user_id: session.user.id, reading_date: today, passage })
      if (error) {
        console.error('Delete completion error', error)
      } else {
        await fetchTodaysCompletions()
      }
    }
  }

  if (session) {
    if (!profileLoaded || profileUserId !== session.user.id) {
      return (
        <div className="min-h-screen bg-[#f8f6ef] flex items-center justify-center p-4">
          <div className="text-center text-emerald-900">
            <p className="text-sm font-medium">Preparing your orchard...</p>
          </div>
        </div>
      )
    }

    if (!displayName.trim()) {
      return (
        <div className="min-h-screen bg-[#f8f6ef] flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl border border-emerald-100 bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-emerald-950">Welcome to Orchard Bible</h1>
              <p className="mt-2 text-sm leading-6 text-stone-600">What should we call you?</p>
            </div>
            <label className="mb-1 block text-xs font-medium text-stone-600" htmlFor="welcome-name">Your display name</label>
            <input
              id="welcome-name"
              className="mb-3 w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-3 py-3 text-base text-stone-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              type="text"
              placeholder="e.g. Pastor James"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              autoFocus
            />
            <button
              onClick={handleSaveName}
              disabled={loading}
              className="w-full rounded-xl bg-emerald-800 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900 disabled:opacity-50"
            >
              Continue to today’s reading
            </button>
            <button
              onClick={handleSignOut}
              className="mt-3 w-full py-2 text-sm text-stone-500 transition hover:text-emerald-800"
            >
              Sign out
            </button>
            {message && <p className="mt-4 text-center text-sm text-stone-500">{message}</p>}
          </div>
        </div>
      )
    }

    if (readingPassageIndex !== null && passages[readingPassageIndex]) {
      const readingPassage = passages[readingPassageIndex]
      const isRead = todaysCompletions.includes(readingPassage.passage)

      return (
        <div
          className={`reading-mode fixed inset-0 z-50 flex min-h-screen flex-col bg-[#fbfaf5] text-stone-800 ${isClosingReadingMode ? 'reading-mode-out' : ''}`}
          onTouchStart={handleReadingTouchStart}
          onTouchEnd={handleReadingTouchEnd}
        >
          <header className="flex items-start justify-between gap-4 border-b border-emerald-100 px-5 pb-4 pt-5 sm:px-8 sm:pt-7">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">{readingPassage.label}</p>
              <h1 className="truncate text-xl font-semibold tracking-tight text-emerald-950 sm:text-2xl">{readingPassage.passage}</h1>
            </div>
            <button
              type="button"
              onClick={closeReadingMode}
              aria-label="Close reading mode"
              className="shrink-0 rounded-full p-2 text-2xl leading-none text-stone-500 transition hover:bg-emerald-50 hover:text-emerald-900"
            >
              ×
            </button>
          </header>

          <main key={`${readingPassage.key}-${readingDirection}`} className={`reading-page reading-page-${readingDirection} flex-1 overflow-y-auto px-5 py-8 sm:px-12 sm:py-12`}>
            <article className="mx-auto max-w-2xl pb-8 text-[1.2rem] leading-[2] text-stone-700 sm:text-[1.35rem]">
              {passageTexts[readingPassage.key] || 'Loading passage text...'}
            </article>
          </main>

          <footer className="border-t border-emerald-100 bg-[#fbfaf5] px-5 pb-6 pt-4 sm:px-8">
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-4">
              <button
                type="button"
                onClick={() => toggleCompletion(readingPassage.passage, !isRead)}
                className={`w-full max-w-sm rounded-xl py-3 text-sm font-semibold transition sm:w-auto sm:min-w-52 ${
                  isRead
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    : 'bg-emerald-800 text-white shadow-sm hover:bg-emerald-900'
                }`}
              >
                {isRead ? '✅ Read' : 'Mark as read'}
              </button>
              <div className="flex items-center gap-2" aria-label={`Passage ${readingPassageIndex + 1} of ${passages.length}`}>
                {passages.map((passage, index) => (
                  <button
                    key={passage.key}
                    type="button"
                    aria-label={`Go to ${passage.label}`}
                    onClick={() => openReadingMode(index)}
                    className={`h-2 rounded-full transition-all ${index === readingPassageIndex ? 'w-6 bg-emerald-700' : 'w-2 bg-emerald-200 hover:bg-emerald-400'}`}
                  />
                ))}
              </div>
            </div>
          </footer>
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-[#f8f6ef] px-3 py-4 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm sm:p-8">
          <div className="relative mb-6 flex flex-col items-center border-b border-emerald-100 pb-5">
            <div className="w-full min-w-0 text-center">
              <img
                src="/logo.png"
                alt="Orchard logo"
                className="mx-auto mb-3 h-20 w-auto object-contain"
              />
              <p className="mt-1 truncate text-sm text-stone-500">{displayName}</p>
            </div>
          </div>

          {todaysReading && (
            <div className="mb-6">
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">
                  Today — {todaysReading.date}
                </p>
                <p className="text-xs text-stone-400">🔥 {streak} day streak</p>
              </div>
              <p className="text-xs text-stone-500 mb-2">{todaysCompletions.length} of 4 read today</p>
              <div className="space-y-2">
                {passages.map(({ key, label, passage }, index) => (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => handlePassageCardClick(index)}
                    onKeyDown={event => handlePassageCardKeyDown(event, index)}
                    className="cursor-pointer border border-stone-200 rounded-lg overflow-hidden"
                  >
                    <div className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left">
                      <div className="flex min-w-0 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={todaysCompletions.includes(passage)}
                          onClick={event => event.stopPropagation()}
                          onChange={e => toggleCompletion(passage, e.target.checked)}
                          className="h-4 w-4 shrink-0 accent-emerald-700"
                        />
                        <div className="min-w-0">
                          <div className="text-xs text-stone-400">{label}</div>
                          <div className="truncate text-sm font-medium text-stone-700">{passage}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation()
                          handlePassageCardClick(index)
                        }}
                        className="shrink-0 text-sm font-medium text-emerald-700 hover:text-emerald-900"
                      >
                        Read
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-stone-700">Orchard Community</h2>
              <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-medium tracking-wide text-stone-600 uppercase">
                {communityMembers.filter(member => member.completedAll).length} complete
              </span>
            </div>
            <div className="mb-3 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-amber-50 to-yellow-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 shadow-sm">
              {communityMembers.length === 0
                ? `${getSeasonalFruitEmoji()} 0% of the congregation has read today`
                : `${getSeasonalFruitEmoji()} ${Math.round((communityMembers.filter(member => member.completedAll).length / communityMembers.length) * 100)}% of the congregation has read today`}
            </div>
            <div className="space-y-2">
              {communityMembers.length === 0 ? (
                <p className="text-xs text-stone-400">No members yet.</p>
              ) : (
                communityMembers.map(member => (
                  <div
                    key={member.id}
                    className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-sm ${
                      member.completedCount === 0
                        ? 'border-stone-100 bg-stone-50 text-stone-500'
                        : member.completedAll
                          ? 'border-amber-300 bg-gradient-to-r from-amber-100 via-emerald-50 to-emerald-100 text-emerald-800 shadow-sm'
                          : 'border-stone-200 bg-white text-stone-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{member.name}</span>
                      {member.completedAll && <span aria-label="Completed all passages">✅</span>}
                    </div>
                    <span className="ml-3 shrink-0 text-xs font-medium text-stone-600">
                      {member.completedCount}/4
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border-t border-stone-200 pt-5 mb-6">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-stone-700">Streak leaderboard</h2>
            </div>
            <div className="space-y-2">
              {leaderboard.length === 0 ? (
                <p className="text-xs text-stone-400">No streaks yet.</p>
              ) : (
                leaderboard.map(member => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between rounded-xl border border-stone-200 bg-gradient-to-r from-stone-50 to-white px-3 py-2 shadow-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-[10px] font-semibold text-white">
                        #{member.rank}
                      </span>
                      <span className="truncate text-sm font-medium text-stone-700">{member.name}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                      🔥 {member.streak}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <label className="mb-1 block text-xs text-stone-500">Your display name</label>
          <input
            className="mb-3 w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            type="text"
            placeholder="e.g. Pastor James"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
          />
          <button
            onClick={handleSaveName}
            disabled={loading}
            className="mb-3 w-full rounded-xl bg-emerald-800 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
          >
            Save name
          </button>
          <button
            onClick={handleSignOut}
            className="w-full rounded-xl border border-emerald-100 py-2 text-sm text-stone-500 hover:bg-emerald-50"
          >
            Sign out
          </button>

          {message && <p className="text-sm text-stone-500 mt-4 text-center">{message}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f8f6ef] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-emerald-100 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 text-center">
          <img
            src="/logo.png"
            alt="Orchard logo"
            className="mx-auto mb-3 h-20 w-auto object-contain"
          />
          <p className="mt-2 text-sm text-stone-500">Sign in to track your reading</p>
        </div>

        <input
          className="mb-3 w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-3 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <input
          className="mb-4 w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-3 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        <div className="flex gap-2">
          <button
            onClick={handleLogin}
            disabled={loading}
            className="flex-1 rounded-xl bg-emerald-800 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
          >
            Sign in
          </button>
          <button
            onClick={handleSignUp}
            disabled={loading}
            className="flex-1 rounded-xl border border-emerald-200 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
          >
            Sign up
          </button>
        </div>

        {message && <p className="text-sm text-stone-500 mt-4 text-center">{message}</p>}
      </div>
    </div>
  )
}