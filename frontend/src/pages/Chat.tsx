import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Trash2, Plus, MessageSquare } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '../lib/api'

interface Message {
  id: number
  role: 'user' | 'assistant'
  message: string
  timestamp: string
}

interface Conversation {
  id: string
  title: string
  last_active: string
  created_at: string
  last_message: string
  message_count: number
}

export default function Chat() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [streamingMessage, setStreamingMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const userId = localStorage.getItem('user_id') || 'default'
  const queryClient = useQueryClient()

  // Fetch conversations list
  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ['conversations', userId],
    queryFn: async () => {
      return await apiClient.get<Conversation[]>(`/api/chat/conversations/list?user_id=${userId}`)
    }
  })

  // Fetch messages for active conversation
  const { data: conversationData } = useQuery({
    queryKey: ['chat-messages', activeConversationId],
    queryFn: async () => {
      if (!activeConversationId) return null
      return await apiClient.get(`/api/chat/conversations/${activeConversationId}/messages`)
    },
    enabled: !!activeConversationId
  })

  const messages: Message[] = conversationData?.messages || []
  const conversationTitle = conversationData?.title || 'New Conversation'

  // Create new conversation mutation
  const createConversationMutation = useMutation({
    mutationFn: async () => {
      return await apiClient.post<{ id: string }>('/api/chat/conversations/new', {
        user_id: userId,
        title: 'New Conversation'
      })
    },
    onSuccess: (data) => {
      setActiveConversationId(data.id)
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  })

  // Delete conversation mutation
  const deleteConversationMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      await apiClient.delete(`/api/chat/conversations/${conversationId}`)
    },
    onSuccess: () => {
      setActiveConversationId(null)
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  })

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingMessage])

  // Auto-select first conversation if none selected
  useEffect(() => {
    if (!activeConversationId && conversations.length > 0) {
      setActiveConversationId(conversations[0].id)
    }
  }, [conversations, activeConversationId])

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    // Create new conversation if none exists
    if (!activeConversationId) {
      const newConv = await createConversationMutation.mutateAsync()
      setActiveConversationId(newConv.id)
    }

    const messageText = input
    setInput('')
    setLoading(true)
    setStreamingMessage('')

    try {
      const response = await apiClient.streamPost('/api/chat/message', {
        user_id: userId,
        conversation_id: activeConversationId,
        message: messageText,
        stream: true,
      })

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              if (parsed.text) {
                setStreamingMessage(prev => prev + parsed.text)
              }
              if (parsed.done) {
                setStreamingMessage('')
                queryClient.invalidateQueries({ queryKey: ['chat-messages', activeConversationId] })
                queryClient.invalidateQueries({ queryKey: ['conversations'] })
              }
            } catch (e) {
              console.error('Parse error:', e)
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      setStreamingMessage('')
    }

    setLoading(false)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleNewChat = () => {
    createConversationMutation.mutate()
  }

  const handleDeleteConversation = (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Delete this conversation?')) {
      deleteConversationMutation.mutate(conversationId)
    }
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-4">
      {/* Sidebar - Conversations List */}
      <div className="w-80 card flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg font-medium hover:from-primary-600 hover:to-secondary-600 transition-all"
          >
            <Plus className="w-5 h-5" />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-slate-400">
              <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No conversations yet</p>
              <p className="text-sm">Start a new chat!</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setActiveConversationId(conv.id)}
                className={`p-4 cursor-pointer border-b border-slate-700 hover:bg-slate-800 transition-colors ${activeConversationId === conv.id ? 'bg-slate-800 border-l-4 border-l-primary-500' : ''
                  }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate">{conv.title}</h3>
                    <p className="text-xs text-slate-400 truncate mt-1">{conv.last_message || 'No messages'}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {conv.message_count} messages · {new Date(conv.last_active).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                    className="p-1 hover:bg-slate-700 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 card flex flex-col overflow-hidden">
        {activeConversationId ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-slate-700">
              <h2 className="text-xl font-semibold">{conversationTitle}</h2>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
              {messages.length === 0 && !streamingMessage && (
                <div className="text-center text-slate-400 mt-20">
                  <h2 className="text-2xl font-semibold mb-2">Start a conversation</h2>
                  <p>Ask me anything about your learning materials!</p>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 flex-shrink-0 flex items-center justify-center text-sm font-bold">
                      AI
                    </div>
                  )}

                  <div
                    className={`max-w-[80%] px-5 py-3 rounded-2xl ${msg.role === 'user'
                        ? 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white'
                        : 'bg-slate-800 text-slate-100'
                      }`}
                  >
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ node, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '')
                            const inline = !match
                            return inline ? (
                              <code className="bg-slate-700 px-1.5 py-0.5 rounded text-sm" {...props}>
                                {children}
                              </code>
                            ) : (
                              <SyntaxHighlighter
                                style={oneDark}
                                language={match[1]}
                                PreTag="div"
                                {...props}
                              >
                                {String(children).replace(/\n$/, '')}
                              </SyntaxHighlighter>
                            )
                          },
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc list-inside mb-2">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
                          li: ({ children }) => <li className="mb-1">{children}</li>,
                          a: ({ href, children }) => (
                            <a href={href} className="text-primary-400 hover:underline" target="_blank" rel="noopener noreferrer">
                              {children}
                            </a>
                          ),
                        }}
                        className="prose prose-invert max-w-none"
                      >
                        {msg.message}
                      </ReactMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.message}</p>
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex-shrink-0 flex items-center justify-center text-sm font-bold">
                      U
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming message */}
              {streamingMessage && (
                <div className="flex gap-4 justify-start">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 flex-shrink-0 flex items-center justify-center text-sm font-bold">
                    AI
                  </div>
                  <div className="max-w-[80%] px-5 py-3 rounded-2xl bg-slate-800 text-slate-100">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-invert max-w-none">
                      {streamingMessage}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-slate-700 p-4">
              <div className="flex gap-3">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type your message..."
                  disabled={loading}
                  rows={1}
                  className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                  style={{ minHeight: '48px', maxHeight: '200px' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="px-6 py-3 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg font-medium hover:from-primary-600 hover:to-secondary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <h2 className="text-2xl font-semibold mb-2">Select a conversation</h2>
              <p>Choose a conversation from the sidebar or start a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
