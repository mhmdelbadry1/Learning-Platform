import { useState } from 'react'
import { LogIn, UserPlus, Loader2 } from 'lucide-react'
import apiClient from '../lib/api'

interface AuthProps {
  onAuth: () => void
}

export default function Auth({ onAuth }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isLogin) {
        // Login
        const response = await apiClient.post<{token: string; user_id: number; username: string; email: string}>('/api/auth/login', {
          email,
          password
        })
        
        localStorage.setItem('auth_token', response.token)
        localStorage.setItem('user_id', String(response.user_id))
        localStorage.setItem('user_email', response.email)
        localStorage.setItem('username', response.username)
        
        onAuth()
      } else {
        // Register
        const response = await apiClient.post<{token: string; user_id: number; username: string; email: string}>('/api/auth/register', {
          username,
          email,
          password
        })
        
        localStorage.setItem('auth_token', response.token)
        localStorage.setItem('user_id', String(response.user_id))
        localStorage.setItem('user_email', response.email)
        localStorage.setItem('username', response.username)
        
        onAuth()
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">
            Learning Platform
          </h1>
          <p className="text-slate-400">AI-Powered Education</p>
        </div>

        <div className="card">
          <div className="flex mb-6">
            <button
              onClick={() => { setIsLogin(true); setError('') }}
              className={`flex-1 py-3 font-medium transition-all ${
                isLogin
                  ? 'text-primary-400 border-b-2 border-primary-400'
                  : 'text-slate-400 border-b-2 border-transparent'
              }`}
            >
              <LogIn className="w-5 h-5 inline mr-2" />
              Login
            </button>
            <button
              onClick={() => { setIsLogin(false); setError('') }}
              className={`flex-1 py-3 font-medium transition-all ${
                !isLogin
                  ? 'text-primary-400 border-b-2 border-primary-400'
                  : 'text-slate-400 border-b-2 border-transparent'
              }`}
            >
              <UserPlus className="w-5 h-5 inline mr-2" />
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium mb-2">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required={!isLogin}
                  minLength={3}
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="johndoe"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="••••••••"
              />
              {!isLogin && (
                <p className="text-xs text-slate-400 mt-1">Minimum 8 characters</p>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg font-medium hover:from-primary-600 hover:to-secondary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {isLogin ? 'Logging in...' : 'Creating account...'}
                </>
              ) : (
                <>
                  {isLogin ? <LogIn className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
                  {isLogin ? 'Login' : 'Create Account'}
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
