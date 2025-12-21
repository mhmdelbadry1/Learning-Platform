import { useState } from 'react'
import { Mic, Volume2, Loader2, Upload } from 'lucide-react'
import apiClient from '../lib/api'

export default function Audio() {
  const [ttsText, setTtsText] = useState('')
  const [ttsLoading, setTtsLoading] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [sttFile, setSttFile] = useState<File | null>(null)
  const [sttLoading, setSttLoading] = useState(false)
  const [transcription, setTranscription] = useState('')

  const synthesizeSpeech = async () => {
    if (!ttsText.trim()) return
    setTtsLoading(true)
    try {
      const response = await apiClient.post<{ request_id: string }>('/api/tts/synthesize', { text: ttsText })
      setTimeout(async () => {
        const audioRes = await apiClient.get<{ url: string }>(`/api/tts/audio/${response.request_id}`)
        setAudioUrl(audioRes.url)
        setTtsLoading(false)
      }, 1500)
    } catch (error) {
      console.error('TTS failed:', error)
      setTtsLoading(false)
    }
  }

  const transcribeAudio = async () => {
    if (!sttFile) return
    setSttLoading(true)
    const formData = new FormData()
    formData.append('file', sttFile)
    try {
      const response = await apiClient.postFormData<{ id: string }>('/api/stt/transcribe', formData)
      setTimeout(async () => {
        const textRes = await apiClient.get<{ text: string }>(`/api/stt/transcription/${response.id}`)
        setTranscription(textRes.text)
        setSttLoading(false)
      }, 2000)
    } catch (error) {
      console.error('STT failed:', error)
      setSttLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Audio</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TTS */}
        <div className="card">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-primary-400" />
            Text-to-Speech
          </h2>
          <textarea
            value={ttsText}
            onChange={(e) => setTtsText(e.target.value)}
            placeholder="Enter text to convert to speech..."
            rows={5}
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 mb-4"
          />
          <button
            onClick={synthesizeSpeech}
            disabled={!ttsText.trim() || ttsLoading}
            className="w-full px-6 py-3 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg font-medium hover:from-primary-600 hover:to-secondary-600 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {ttsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Volume2 className="w-5 h-5" />}
            {ttsLoading ? 'Generating...' : 'Generate Speech'}
          </button>
          {audioUrl && (
            <div className="mt-4">
              <audio controls className="w-full" src={audioUrl} />
              <a href={audioUrl} download className="text-sm text-primary-400 hover:underline mt-2 block">
                Download Audio
              </a>
            </div>
          )}
        </div>

        {/* STT */}
        <div className="card">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Mic className="w-5 h-5 text-secondary-400" />
            Speech-to-Text
          </h2>
          <label className="block w-full px-4 py-12 border-2 border-dashed border-slate-700 rounded-lg text-center cursor-pointer hover:border-slate-600 transition-colors mb-4">
            <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
            <p className="text-slate-400">{sttFile ? sttFile.name : 'Upload audio file'}</p>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => setSttFile(e.target.files?.[0] || null)}
            />
          </label>
          <button
            onClick={transcribeAudio}
            disabled={!sttFile || sttLoading}
            className="w-full px-6 py-3 bg-gradient-to-r from-secondary-500 to-primary-500 rounded-lg font-medium hover:from-secondary-600 hover:to-primary-600 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {sttLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />}
            {sttLoading ? 'Transcribing...' : 'Transcribe'}
          </button>
          {transcription && (
            <div className="mt-4 p-4 bg-slate-800 rounded-lg">
              <p className="text-sm font-medium text-slate-400 mb-2">Transcription:</p>
              <p>{transcription}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
