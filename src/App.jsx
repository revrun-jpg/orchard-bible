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

  if (session) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 w-full max-w-sm">
          <h1 className="text-xl font-semibold text-stone-800 mb-1">Orchard Bible</h1>
          <p className="text-sm text-stone-500 mb-6">{displayName || session.user.email}</p>

          {todaysReading && (
            <div className="mb-6">
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-3">
                Today — {todaysReading.date}
              </p>
              <div className="space-y-2">
                {passages.map(({ key, label, passage }) => (
                  <div
                    key={key}
                    className="border border-stone-200 rounded-lg overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedPassage(expandedPassage === key ? null : key)}
                      className="flex items-center justify-between w-full px-3 py-2 text-left"
                    >
                      <span className="text-xs text-stone-400">{label}</span>
                      <span className="text-sm text-stone-700 font-medium">{passage}</span>
                    </button>
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