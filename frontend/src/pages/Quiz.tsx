import { useState } from 'react'
import { Brain, Loader2, CheckCircle, XCircle, ArrowRight } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import apiClient from '../lib/api'

interface Document {
  id: string
  filename: string
  file_type: string
  uploaded_at: string
  processed: boolean
}

interface QuizQuestion {
  id: number
  type: string
  question: string
  options?: string[]
}

interface QuizAnswer {
  question_id: number
  answer: string
}

interface QuizResult {
  score: number
  correct_count: number
  total_questions: number
  feedback: Array<{
    question_id: number
    question: string
    user_answer: string
    correct_answer: string
    is_correct: boolean
    explanation: string
  }>
}

export default function Quiz() {
  const [step, setStep] = useState<'select' | 'quiz' | 'results'>('select')
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)
  const [quizId, setQuizId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [results, setResults] = useState<QuizResult | null>(null)
  const userId = localStorage.getItem('user_id') || 'default'

  // Fetch documents
  const { data: documents = [], isLoading: docsLoading } = useQuery<Document[]>({
    queryKey: ['documents', userId],
    queryFn: async () => {
      return await apiClient.get<Document[]>(`/api/documents?user_id=${userId}`)
    }
  })

  // Generate quiz mutation
  const generateMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await apiClient.post<{ quiz_id: string, title: string, num_questions: number }>('/api/quiz/generate', {
        document_id: documentId,
        num_questions: 5,
        question_types: ['multiple_choice', 'true_false']
      })
      return response
    },
    onSuccess: async (data) => {
      setQuizId(data.quiz_id)
      // Fetch quiz questions
      const quizData = await apiClient.get<{ questions: QuizQuestion[] }>(`/api/quiz/${data.quiz_id}`)
      setQuestions(quizData.questions)
      setStep('quiz')
      setAnswers({})
    }
  })

  // Submit quiz mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!quizId) throw new Error('No quiz ID')
      const answersList: QuizAnswer[] = Object.entries(answers).map(([qId, answer]) => ({
        question_id: parseInt(qId),
        answer
      }))

      const response = await apiClient.post<QuizResult>(`/api/quiz/${quizId}/submit`, {
        quiz_id: quizId,
        user_id: userId,
        answers: answersList
      })
      return response
    },
    onSuccess: (data) => {
      setResults(data)
      setStep('results')
    }
  })

  const resetQuiz = () => {
    setStep('select')
    setSelectedDoc(null)
    setQuizId(null)
    setQuestions([])
    setAnswers({})
    setResults(null)
  }

  const processedDocs = documents.filter(d => d.processed)

  if (step === 'select') {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Generate Quiz</h1>

        {docsLoading ? (
          <div className="card text-center py-20">
            <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary-400" />
            <p className="text-slate-400">Loading documents...</p>
          </div>
        ) : processedDocs.length === 0 ? (
          <div className="card text-center py-20">
            <Brain className="w-16 h-16 mx-auto mb-4 text-slate-600" />
            <h2 className="text-2xl font-semibold mb-2">No Documents Available</h2>
            <p className="text-slate-400 mb-6">Upload and process documents first to generate quizzes</p>
            <a
              href="/documents"
              className="inline-block px-6 py-3 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg font-medium hover:from-primary-600 hover:to-secondary-600"
            >
              Go to Documents
            </a>
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-slate-400">Select a document to generate a quiz:</p>
            {processedDocs.map((doc) => (
              <div
                key={doc.id}
                onClick={() => {
                  setSelectedDoc(doc)
                  generateMutation.mutate(doc.id)
                }}
                className={`card cursor-pointer hover:border-primary-500 transition-all ${generateMutation.isPending && selectedDoc?.id === doc.id ? 'opacity-50' : ''
                  }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{doc.filename}</h3>
                    <p className="text-sm text-slate-400">
                      {new Date(doc.uploaded_at).toLocaleDateString()} • {doc.file_type.toUpperCase()}
                    </p>
                  </div>
                  {generateMutation.isPending && selectedDoc?.id === doc.id ? (
                    <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
                  ) : (
                    <ArrowRight className="w-6 h-6 text-primary-400" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {generateMutation.isError && (
          <div className="card bg-red-500/10 border-red-500 flex items-center gap-3">
            <XCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-400">
              {(generateMutation.error as any)?.response?.data?.detail || 'Quiz generation failed'}
            </p>
          </div>
        )}
      </div>
    )
  }

  if (step === 'quiz') {
    const allAnswered = questions.every(q => answers[q.id] !== undefined)

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Quiz: {selectedDoc?.filename}</h1>
          <button onClick={resetQuiz} className="text-slate-400 hover:text-white transition-colors">
            Cancel
          </button>
        </div>

        <div className="text-sm text-slate-400 mb-6">
          Answer all {questions.length} questions below:
        </div>

        <div className="space-y-6">
          {questions.map((q, idx) => (
            <div key={q.id} className="card">
              <h3 className="text-lg font-semibold mb-4">
                {idx + 1}. {q.question}
              </h3>
              <div className="space-y-2">
                {q.options ? (
                  // Multiple choice
                  q.options.map((opt, optIdx) => (
                    <button
                      key={optIdx}
                      onClick={() => setAnswers({ ...answers, [q.id]: opt })}
                      className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${answers[q.id] === opt
                          ? 'border-primary-500 bg-primary-500/20'
                          : 'border-slate-700 hover:border-slate-600'
                        }`}
                    >
                      {opt}
                    </button>
                  ))
                ) : q.type === 'true_false' ? (
                  // True/False
                  ['True', 'False'].map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setAnswers({ ...answers, [q.id]: opt.toLowerCase() })}
                      className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${answers[q.id] === opt.toLowerCase()
                          ? 'border-primary-500 bg-primary-500/20'
                          : 'border-slate-700 hover:border-slate-600'
                        }`}
                    >
                      {opt}
                    </button>
                  ))
                ) : (
                  // Short answer
                  <input
                    type="text"
                    value={answers[q.id] || ''}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    placeholder="Type your answer..."
                    className="w-full px-4 py-3 bg-slate-800 border-2 border-slate-700 rounded-lg focus:border-primary-500 focus:outline-none"
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => submitMutation.mutate()}
          disabled={!allAnswered || submitMutation.isPending}
          className="w-full px-6 py-4 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg font-medium hover:from-primary-600 hover:to-secondary-600 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitMutation.isPending ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Submitting...
            </>
          ) : (
            'Submit Quiz'
          )}
        </button>
      </div>
    )
  }

  if (step === 'results' && results) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Quiz Results</h1>

        {/* Score Card */}
        <div className="card text-center py-12 bg-gradient-to-br from-primary-500/10 to-secondary-500/10">
          <div className="text-7xl font-bold mb-4 bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">
            {results.score.toFixed(0)}%
          </div>
          <p className="text-2xl text-slate-300 mb-2">
            {results.correct_count} out of {results.total_questions} correct
          </p>
          <p className="text-slate-400">
            {results.score >= 80 ? '🎉 Excellent work!' : results.score >= 60 ? '👍 Good job!' : '📚 Keep practicing!'}
          </p>
        </div>

        {/* Detailed Feedback */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Detailed Feedback</h2>
          {results.feedback.map((fb, idx) => (
            <div key={fb.question_id} className={`card ${fb.is_correct ? 'border-emerald-500/50' : 'border-red-500/50'}`}>
              <div className="flex items-start gap-3 mb-3">
                {fb.is_correct ? (
                  <CheckCircle className="w-6 h-6 text-emerald-500 flex-shrink-0 mt-1" />
                ) : (
                  <XCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-1" />
                )}
                <div className="flex-1">
                  <h3 className="font-semibold mb-2">
                    {idx + 1}. {fb.question}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <p className={fb.is_correct ? 'text-emerald-400' : 'text-red-400'}>
                      Your answer: <span className="font-medium">{fb.user_answer}</span>
                    </p>
                    {!fb.is_correct && (
                      <p className="text-slate-400">
                        Correct answer: <span className="font-medium text-emerald-400">{fb.correct_answer}</span>
                      </p>
                    )}
                    {fb.explanation && (
                      <p className="text-slate-300 mt-3 p-3 bg-slate-800/50 rounded-lg">
                        💡 {fb.explanation}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={resetQuiz}
          className="w-full px-6 py-4 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium transition-colors"
        >
          Take Another Quiz
        </button>
      </div>
    )
  }

  return null
}
