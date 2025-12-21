import { useState } from 'react'
import { Upload, FileText, Download, Trash2, Loader2, CheckCircle, XCircle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '../lib/api'

interface Document {
  id: string
  filename: string
  file_type: string
  uploaded_at: string
  processed: boolean
}

export default function Documents() {
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  const queryClient = useQueryClient()
  const userId = localStorage.getItem('user_id') || 'default'

  // Fetch documents
  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ['documents', userId],
    queryFn: async () => {
      const docs = await apiClient.get<Document[]>(`/api/documents?user_id=${userId}`)
      return docs
    },
    refetchInterval: 5000, // Keep polling to check processing status
    staleTime: 0 // Always consider data stale so cache invalidation works immediately
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/api/documents/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    }
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadStatus(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('user_id', userId)

      const response = await apiClient.postFormData<{ id: string, filename: string, message: string }>(
        '/api/documents/upload',
        formData
      )

      setUploadStatus({ type: 'success', message: response.message })
      queryClient.invalidateQueries({ queryKey: ['documents'] })

      // Reset file input
      e.target.value = ''
    } catch (error: any) {
      setUploadStatus({
        type: 'error',
        message: error.response?.data?.detail || 'Upload failed'
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Documents</h1>
        <label className="px-6 py-3 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg font-medium cursor-pointer hover:from-primary-600 hover:to-secondary-600 flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Upload Document
          <input
            type="file"
            accept=".pdf,.docx,.doc,.txt"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      {/* Upload Status */}
      {uploadStatus && (
        <div className={`card animate-fade-in flex items-center gap-3 ${uploadStatus.type === 'success' ? 'bg-emerald-500/10 border-emerald-500' : 'bg-red-500/10 border-red-500'
          }`}>
          {uploadStatus.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-500" />
          ) : (
            <XCircle className="w-5 h-5 text-red-500" />
          )}
          <p className={uploadStatus.type === 'success' ? 'text-emerald-400' : 'text-red-400'}>
            {uploadStatus.message}
          </p>
        </div>
      )}

      {uploading && (
        <div className="card flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-primary-400" />
          <p>Uploading document...</p>
        </div>
      )}

      {/* Documents List */}
      {isLoading ? (
        <div className="card text-center py-20">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary-400" />
          <p className="text-slate-400">Loading documents...</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="card text-center py-20">
          <FileText className="w-16 h-16 mx-auto mb-4 text-slate-600" />
          <h2 className="text-xl font-semibold mb-2">No Documents Yet</h2>
          <p className="text-slate-400 mb-6">Upload your first document to get started</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {documents.map((doc) => (
            <div key={doc.id} className="card hover:border-primary-500 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  <div className="p-3 rounded-lg bg-gradient-to-br from-primary-500 to-secondary-500">
                    <FileText className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{doc.filename}</h3>
                    <p className="text-sm text-slate-400">
                      Uploaded {new Date(doc.uploaded_at).toLocaleDateString()} • {doc.file_type.toUpperCase()}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {doc.processed ? (
                        <span className="text-xs text-emerald-400 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Processed
                        </span>
                      ) : (
                        <span className="text-xs text-amber-400 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Processing...
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => deleteMutation.mutate(doc.id)}
                    disabled={deleteMutation.isPending}
                    className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-red-400 hover:text-red-300"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
