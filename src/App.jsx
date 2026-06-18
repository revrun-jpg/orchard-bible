import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

export default function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

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

  if (session) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 w-full max-w-sm">
          <h1 className="text-xl font-semibold text-stone-800 mb-1">Orchard Bible</h1>
          <p className="text-sm text-stone-500 mb-6">{session.user.email}</p>

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