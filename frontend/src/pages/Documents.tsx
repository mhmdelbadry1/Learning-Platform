import { useState } from 'react'
import { Upload, FileText, Download, Trash2, Loader2 } from 'lucide-react'
import apiClient from '../lib/api'

interface Document {
  id: string
  filename: string
  s3_url: string
  notes?: string
  uploaded_at: string
}

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const userId = localStorage.getItem('user_id') || 'dev-user'

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    setUploading(true)
    const file = files[0]
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await apiClient.postFormData<Document>(`/api/documents/upload?user_id=${userId}`, formData)
      setDocuments(prev => [response, ...prev])
    } catch (error) {
      console.error('Upload failed:', error)
      alert('Upload failed. Please try again.')
    }

    setUploading(false)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Documents</h1>

      {/* Upload Zone */}
      <div
        className={`card border-2 border-dashed transition-all ${
          dragActive ? 'border-primary-500 bg-primary-500/10' : 'border-slate-700'
        }`}
        onDragEnter={() => setDragActive(true)}
        onDragLeave={() => setDragActive(false)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          handleFileUpload(e.dataTransfer.files)
        }}
      >
        <div className="text-center py-12">
          <Upload className="w-12 h-12 mx-auto mb-4 text-slate-400" />
          <h3 className="text-xl font-semibold mb-2">Upload Document</h3>
          <p className="text-slate-400 mb-4">Drag & drop or click to select</p>
          <label className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg cursor-pointer hover:from-primary-600 hover:to-secondary-600">
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
            {uploading ? 'Uploading...' : 'Select File'}
            <input
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(e) => handleFileUpload(e.target.files)}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* Documents Grid */}
      {documents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div key={doc.id} className="card hover:scale-105 transition-transform">
              <div className="flex items-start gap-3">
                <FileText className="w-8 h-8 text-primary-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{doc.filename}</h3>
                  <p className="text-sm text-slate-400">
                    {new Date(doc.uploaded_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {doc.notes && (
                <p className="mt-3 text-sm text-slate-300">{doc.notes.slice(0, 100)}...</p>
              )}
              <div className="flex gap-2 mt-4">
                <button className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">
                  <Download className="w-4 h-4 inline mr-2" />
                  Download
                </button>
                <button className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-sm">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
