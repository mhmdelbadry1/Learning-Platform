import { Link, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  MessageSquare, 
  FileText, 
  Brain, 
  Mic,
  User
} from 'lucide-react'

interface SidebarProps {
  isOpen: boolean
}

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/chat', icon: MessageSquare, label: 'AI Chat' },
  { path: '/documents', icon: FileText, label: 'Documents' },
  { path: '/quiz', icon: Brain, label: 'Quiz' },
  { path: '/audio', icon: Mic, label: 'Audio' },
  { path: '/profile', icon: User, label: 'Profile' },
]

export default function Sidebar({ isOpen }: SidebarProps) {
  const location = useLocation()

  return (
    <aside
      className={`fixed left-0 top-16 h-[calc(100vh-4rem)] glass border-r border-slate-700/50 transition-all duration-300 ${
        isOpen ? 'w-64' : 'w-0'
      } overflow-hidden`}
    >
      <nav className="p-4 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = location.pathname === item.path
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-primary-500/20 to-secondary-500/20 text-primary-400 border border-primary-500/30'
                  : 'hover:bg-slate-700/50 text-slate-300'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
