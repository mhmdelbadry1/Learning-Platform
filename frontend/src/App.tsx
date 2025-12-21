import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import Chat from './pages/Chat'
import Documents from './pages/Documents'
import Quiz from './pages/Quiz'
import Audio from './pages/Audio'
import Profile from './pages/Profile'
import Auth from './pages/Auth'

const queryClient = new QueryClient()

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(true) // Start as true in dev mode
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    // Check if user is authenticated (check for JWT token)
    let token = localStorage.getItem('auth_token')
    
    // DEV MODE: Auto-create token if none exists
    if (!token) {
      const devToken = 'dev-token-' + Date.now()
      const devUserId = 'dev-user-' + Date.now()
      localStorage.setItem('auth_token', devToken)
      localStorage.setItem('user_id', devUserId)
      localStorage.setItem('user_email', 'dev@example.com')
      token = devToken
    }
    
    setIsAuthenticated(!!token)
    setLoading(false)
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-primary-400 text-xl">Loading...</div>
      </div>
    )
  }

  const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    return isAuthenticated ? <>{children}</> : <Navigate to="/auth" replace />
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Auth route */}
          <Route path="/auth" element={<Auth onAuth={() => setIsAuthenticated(true)} />} />
          
          {/* Protected routes with layout */}
          <Route path="/" element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }>
            <Route index element={<Dashboard />} />
            <Route path="chat" element={<Chat />} />
            <Route path="documents" element={<Documents />} />
            <Route path="quiz" element={<Quiz />} />
            <Route path="audio" element={<Audio />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
