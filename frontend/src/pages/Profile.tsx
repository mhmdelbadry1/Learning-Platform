import { User, Mail, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import apiClient from '../lib/api'

interface UserData {
  id: number
  username: string
  email: string
  created_at: string
  is_active: boolean
}

export default function Profile() {
  const navigate = useNavigate()
  const userId = localStorage.getItem('user_id')
  const username = localStorage.getItem('username')
  const email = localStorage.getItem('user_email')

  // Fetch full user data from API
  const { data: userData } = useQuery<UserData>({
    queryKey: ['user', userId],
    queryFn: async () => {
      return await apiClient.get<UserData>('/api/auth/me')
    },
    enabled: !!userId
  })

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('user_id')
    localStorage.removeItem('username')
    localStorage.removeItem('user_email')
    navigate('/auth')
  }

  const displayUsername = userData?.username || username || 'User'
  const displayEmail = userData?.email || email || 'user@example.com'
  const joinDate = userData?.created_at
    ? new Date(userData.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : 'Recently'

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Profile</h1>

      <div className="card">
        <div className="flex items-center gap-6 mb-6">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center text-3xl font-bold">
            {displayUsername.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-2xl font-bold">{displayUsername}</h2>
            <p className="text-slate-400">Member since {joinDate}</p>
            {userData && (
              <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium ${userData.is_active
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/20 text-red-400'
                }`}>
                {userData.is_active ? 'Active' : 'Inactive'}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-lg">
            <User className="w-5 h-5 text-primary-400" />
            <div>
              <p className="text-sm text-slate-400">Username</p>
              <p className="font-medium">{displayUsername}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-lg">
            <Mail className="w-5 h-5 text-primary-400" />
            <div>
              <p className="text-sm text-slate-400">Email</p>
              <p className="font-medium">{displayEmail}</p>
            </div>
          </div>

          {userData?.id && (
            <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-lg">
              <User className="w-5 h-5 text-primary-400" />
              <div>
                <p className="text-sm text-slate-400">User ID</p>
                <p className="font-medium">#{userData.id}</p>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleLogout}
          className="w-full mt-6 px-6 py-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded-lg font-medium text-red-400 hover:text-red-300 flex items-center justify-center gap-2 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Logout
        </button>
      </div>
    </div>
  )
}
