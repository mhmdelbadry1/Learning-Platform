import { motion } from 'framer-motion'
import { MessageSquare, FileText, Brain, TrendingUp } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import apiClient from '../lib/api'

interface Document {
  id: string
  filename: string
  uploaded_at: string
}

interface QuizHistory {
  quiz_id: string
  title: string
  score: number
  submitted_at: string
}

export default function Dashboard() {
  const userId = localStorage.getItem('user_id') || 'default'
  const username = localStorage.getItem('username') || 'User'

  // Fetch documents count
  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ['documents', userId],
    queryFn: async () => {
      return await apiClient.get<Document[]>(`/api/documents?user_id=${userId}`)
    }
  })

  // Fetch quiz history
  const { data: quizHistory = [] } = useQuery<QuizHistory[]>({
    queryKey: ['quiz-history', userId],
    queryFn: async () => {
      return await apiClient.get<QuizHistory[]>(`/api/quiz/history?user_id=${userId}&limit=20`)
    }
  })

  // Fetch conversation count (number of distinct conversations, not messages)
  const { data: conversationData = [] } = useQuery({
    queryKey: ['conversations', userId],
    queryFn: async () => {
      return await apiClient.get(`/api/chat/conversations?user_id=${userId}`)
    }
  })

  // Calculate average quiz score
  const avgScore = quizHistory.length > 0
    ? Math.round(quizHistory.reduce((sum, q) => sum + q.score, 0) / quizHistory.length)
    : 0

  const stats = [
    {
      label: 'Conversations',
      value: conversationData.length.toString(),
      icon: MessageSquare,
      color: 'from-primary-500 to-primary-600'
    },
    {
      label: 'Documents',
      value: documents.length.toString(),
      icon: FileText,
      color: 'from-secondary-500 to-secondary-600'
    },
    {
      label: 'Quizzes Taken',
      value: quizHistory.length.toString(),
      icon: Brain,
      color: 'from-accent-500 to-accent-600'
    },
    {
      label: 'Avg Quiz Score',
      value: `${avgScore}%`,
      icon: TrendingUp,
      color: 'from-emerald-500 to-emerald-600'
    },
  ]

  // Get recent documents (last 3)
  const recentDocuments = documents
    .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
    .slice(0, 3)

  // Get recent quiz results (last 3)
  const recentQuizzes = quizHistory.slice(0, 3)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Welcome Back, {username}!</h1>
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
        {/* Recent Documents */}
        <div className="card">
          <h3 className="text-xl font-semibold mb-4">Recent Documents</h3>
          {recentDocuments.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 mx-auto mb-2 text-slate-600" />
              <p className="text-slate-400">No documents yet</p>
              <a href="/documents" className="text-primary-400 hover:text-primary-300 text-sm mt-2 inline-block">
                Upload your first document →
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {recentDocuments.map((doc) => (
                <div key={doc.id} className="p-3 bg-slate-800/50 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer">
                  <p className="font-medium truncate">{doc.filename}</p>
                  <p className="text-sm text-slate-400">
                    {new Date(doc.uploaded_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Quiz Results */}
        <div className="card">
          <h3 className="text-xl font-semibold mb-4">Recent Quiz Results</h3>
          {recentQuizzes.length === 0 ? (
            <div className="text-center py-8">
              <Brain className="w-12 h-12 mx-auto mb-2 text-slate-600" />
              <p className="text-slate-400">No quizzes taken yet</p>
              <a href="/quiz" className="text-primary-400 hover:text-primary-300 text-sm mt-2 inline-block">
                Generate your first quiz →
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {recentQuizzes.map((quiz) => (
                <div key={quiz.quiz_id} className="p-3 bg-slate-800/50 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium truncate">{quiz.title}</p>
                      <p className="text-sm text-slate-400">
                        {new Date(quiz.submitted_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded text-sm font-medium ${quiz.score >= 80 ? 'bg-emerald-500/20 text-emerald-400' :
                      quiz.score >= 60 ? 'bg-amber-500/20 text-amber-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                      {quiz.score.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
