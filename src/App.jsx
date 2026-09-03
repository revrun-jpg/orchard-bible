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
  const [expandedPassage, setExpandedPassage] = useState(null)
  const [todaysCompletions, setTodaysCompletions] = useState([])
  const [streak, setStreak] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    supabase.auth.onAuthStateChange((_event, session) => setSession(session))
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (data?.display_name) setDisplayName(data.display_name)
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
        'include-headings': 'false',
        'include-verse-numbers': 'true',
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

  useEffect(() => {
    fetchTodaysCompletions()
  }, [session, todaysReading])

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

      // Group by date (normalize to YYYY-MM-DD)
      const groups = {}
      (data || []).forEach(row => {
        const dateKey = row?.reading_date ? new Date(row.reading_date).toISOString().slice(0, 10) : null
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

      console.debug('computeStreak: fetched rows', (data || []).length)
      console.debug('computeStreak: groups keys', Object.keys(groups))
      console.debug('computeStreak: today group size', groups[todayKey]?.size || 0)

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
    setLoading(true)
    const { error } = await supabase.from('profiles').upsert({
      id: session.user.id,
      display_name: displayName,
    })
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
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 w-full max-w-sm">
          <h1 className="text-xl font-semibold text-stone-800 mb-1">Orchard Bible</h1>
          <p className="text-sm text-stone-500 mb-6">{displayName || session.user.email}</p>

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
                {passages.map(({ key, label, passage }) => (
                  <div
                    key={key}
                    className="border border-stone-200 rounded-lg overflow-hidden"
                  >
                    <div className="flex items-center justify-between w-full px-3 py-2 text-left">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={todaysCompletions.includes(passage)}
                          onChange={e => toggleCompletion(passage, e.target.checked)}
                          className="w-4 h-4"
                        />
                        <div>
                          <div className="text-xs text-stone-400">{label}</div>
                          <div className="text-sm text-stone-700 font-medium truncate">{passage}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => setExpandedPassage(expandedPassage === key ? null : key)}
                        className="text-sm text-stone-400"
                      >
                        {expandedPassage === key ? 'Close' : 'Open'}
                      </button>
                    </div>
                    {expandedPassage === key && (
                      <div className="px-3 py-2 border-t border-stone-200 text-sm text-stone-600 whitespace-pre-wrap">
                        {passageTexts[key] || 'Loading…'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="text-xs text-stone-500 mb-1 block">Your display name</label>
          <input
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:ring-2 focus:ring-stone-300"
            type="text"
            placeholder="e.g. Pastor James"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
          />
          <button
            onClick={handleSaveName}
            disabled={loading}
            className="w-full bg-stone-800 text-white text-sm rounded-lg py-2 hover:bg-stone-700 mb-3 disabled:opacity-50"
          >
            Save name
          </button>
          <button
            onClick={handleSignOut}
            className="w-full border border-stone-200 text-stone-500 text-sm rounded-lg py-2 hover:bg-stone-50"
          >
            Sign out
          </button>

          {message && <p className="text-sm text-stone-500 mt-4 text-center">{message}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold text-stone-800 mb-1">Orchard Bible</h1>
        <p className="text-sm text-stone-500 mb-6">Sign in to track your reading</p>

        <input
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:ring-2 focus:ring-stone-300"
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <input
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-4 outline-none focus:ring-2 focus:ring-stone-300"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        <div className="flex gap-2">
          <button
            onClick={handleLogin}
            disabled={loading}
            className="flex-1 bg-stone-800 text-white text-sm rounded-lg py-2 hover:bg-stone-700 disabled:opacity-50"
          >
            Sign in
          </button>
          <button
            onClick={handleSignUp}
            disabled={loading}
            className="flex-1 border border-stone-200 text-stone-700 text-sm rounded-lg py-2 hover:bg-stone-50 disabled:opacity-50"
          >
            Sign up
          </button>
        </div>

        {message && <p className="text-sm text-stone-500 mt-4 text-center">{message}</p>}
      </div>
    </div>
  )
}