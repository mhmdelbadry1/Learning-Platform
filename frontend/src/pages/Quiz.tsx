import { useState } from 'react'
import { Brain } from 'lucide-react'
import apiClient from '../lib/api'

interface QuizQuestion {
  question: string
  options: string[]
  correct_answer: string
}

export default function Quiz() {
  const [quizId, setQuizId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [results, setResults] = useState<{ score: number; total: number } | null>(null)
  const [generating, setGenerating] = useState(false)
  const userId = localStorage.getItem('user_id') || 'dev-user'

  const generateQuiz = async () => {
    setGenerating(true)
    try {
      const response = await apiClient.post<{ quiz_id: string }>('/api/quiz/generate', {
        user_id: userId,
        document_id: 'demo-doc',
        topic: 'General Knowledge'
      })
      setQuizId(response.quiz_id)
      // Fetch quiz questions (mock for now)
      setQuestions([
        {
          question: 'What is React?',
          options: ['A library', 'A framework', 'A language', 'A database'],
          correct_answer: 'A library'
        }
      ])
    } catch (error) {
      console.error('Generate failed:', error)
    }
    setGenerating(false)
  }

  const submitQuiz = async () => {
    const score = questions.reduce((acc, q, idx) => {
      return acc + (answers[idx] === q.correct_answer ? 1 : 0)
    }, 0)
    setResults({ score, total: questions.length })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Quiz</h1>

      {!quizId ? (
        <div className="card text-center py-20">
          <Brain className="w-16 h-16 mx-auto mb-4 text-primary-400" />
          <h2 className="text-2xl font-semibold mb-4">Generate AI Quiz</h2>
          <button
            onClick={generateQuiz}
            disabled={generating}
            className="px-8 py-4 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg font-medium hover:from-primary-600 hover:to-secondary-600 disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate Quiz'}
          </button>
        </div>
      ) : results ? (
        <div className="card text-center py-20">
          <div className="text-6xl font-bold mb-4 bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">
            {results.score}/{results.total}
          </div>
          <p className="text-xl text-slate-300 mb-8">
            {results.score === results.total ? 'Perfect Score!' : `You got ${Math.round((results.score / results.total) * 100)}%`}
          </p>
          <button onClick={() => { setQuizId(null); setResults(null); setAnswers({}) }} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg">
            Take Another Quiz
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {questions.map((q, idx) => (
            <div key={idx} className="card">
              <h3 className="text-lg font-semibold mb-4">
                {idx + 1}. {q.question}
              </h3>
              <div className="space-y-2">
                {q.options.map((opt, optIdx) => (
                  <button
                    key={optIdx}
                    onClick={() => setAnswers({ ...answers, [idx]: opt })}
                    className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                      answers[idx] === opt
                        ? 'border-primary-500 bg-primary-500/20'
                        : 'border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            onClick={submitQuiz}
            disabled={Object.keys(answers).length !== questions.length}
            className="w-full px-6 py-4 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg font-medium hover:from-primary-600 hover:to-secondary-600 disabled:opacity-50"
          >
            Submit Quiz
          </button>
        </div>
      )}
    </div>
  )
}
