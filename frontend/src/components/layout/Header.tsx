import { Menu, Bell, User } from 'lucide-react'

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 glass border-b border-slate-700/50 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Left: Menu + Logo */}
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
            aria-label="Toggle menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">
            Learning Platform
          </h1>
        </div>

        {/* Right: Notifications + Profile */}
        <div className="flex items-center gap-3">
          <button
            className="relative p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-secondary-500 rounded-full"></span>
          </button>
          
          <button
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
            aria-label="User profile"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <span className="text-sm font-medium hidden md:block">User</span>
          </button>
        </div>
      </div>
    </header>
  )
}
