import { motion } from 'framer-motion'
import { MessageSquare, FileText, Brain, TrendingUp } from 'lucide-react'

export default function Dashboard() {
  const stats = [
    { label: 'Conversations', value: '24', icon: MessageSquare, color: 'from-primary-500 to-primary-600' },
    { label: 'Documents', value: '12', icon: FileText, color: 'from-secondary-500 to-secondary-600' },
    { label: 'Quizzes Taken', value: '8', icon: Brain, color: 'from-emerald-500 to-emerald-600' },
    { label: 'Learning Streak', value: '7 days', icon: TrendingUp, color: 'from-amber-500 to-amber-600' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Welcome Back!</h1>
        <p className="text-slate-400">Here's what's happening with your learning today.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="card hover:scale-105 transition-transform cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg bg-gradient-to-br ${stat.color}`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className=" text-slate-400 text-sm">{stat.label}</p>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Chats */}
        <div className="card">
          <h3 className="text-xl font-semibold mb-4">Recent Conversations</h3>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-3 bg-slate-800/50 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer">
                <p className="font-medium">Learning Python basics</p>
                <p className="text-sm text-slate-400">2 hours ago</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Documents */}
        <div className="card">
          <h3 className="text-xl font-semibold mb-4">Recent Documents</h3>
          <div className="space-y-3">
           {[1, 2, 3].map((i) => (
              <div key={i} className="p-3 bg-slate-800/50 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer">
                <p className="font-medium">Machine Learning Guide.pdf</p>
                <p className="text-sm text-slate-400">Uploaded 1 day ago</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
