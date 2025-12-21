import { User, Mail, LogOut } from 'lucide-react'

export default function Profile() {
  const userEmail = localStorage.getItem('user_email') || 'dev@example.com'
  const userId = localStorage.getItem('user_id') || 'dev-user'

  const handleLogout = () => {
    localStorage.clear()
    window.location.href = '/auth'
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Profile & Settings</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile Info */}
        <div className="card">
          <h2 className="text-xl font-semibold mb-6">Profile Information</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">User ID</label>
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg">
                <User className="w-5 h-5 text-slate-400" />
                <span className="text-sm text-slate-300">{userId}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg">
                <Mail className="w-5 h-5 text-slate-400" />
                <span className="text-sm text-slate-300">{userEmail}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="card">
          <h2 className="text-xl font-semibold mb-6">Security</h2>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-medium transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="card">
        <h2 className="textxl font-semibold mb-6">Your Activity</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Chats', value: '24' },
            { label: 'Documents', value: '12' },
            { label: 'Quizzes', value: '8' },
            { label: 'Audio Files', value: '15' },
          ].map((stat) => (
            <div key={stat.label} className="text-center p-4 bg-slate-800 rounded-lg">
              <p className="text-3xl font-bold text-primary-400">{stat.value}</p>
              <p className="text-sm text-slate-400 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
