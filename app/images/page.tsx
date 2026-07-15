'use client'

import SectionTabs from '@/components/navigation/SectionTabs'
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Images,
  Upload,
  Trash2,
  Download,
  RefreshCw,
  ImageOff,
  ZoomIn,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ImagePlus,
} from 'lucide-react'
import type { ImageEntry } from '@/lib/imageLibrary'

export default function ImagesPage() {
  const [images, setImages] = useState<ImageEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [lightbox, setLightbox] = useState<ImageEntry | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchImages = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/image-library')
      const data = await res.json()
      setImages(data.images ?? [])
    } catch {
      showToast('error', '画像一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchImages()
  }, [fetchImages])

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length === 0) {
        showToast('error', '画像ファイルを選択してください')
        return
      }
      setUploading(true)
      let okCount = 0
      try {
        for (const file of imageFiles) {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const result = reader.result as string
              resolve(result.split(',')[1] ?? '')
            }
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          const res = await fetch('/api/image-library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64: base64,
              mimeType: file.type,
              title: file.name.replace(/\.[^.]+$/, ''),
              source: 'uploaded',
            }),
          })
          if (res.ok) okCount++
        }
        if (okCount > 0) {
          showToast('success', `${okCount}件の画像をアップロードしました`)
          await fetchImages()
        } else {
          showToast('error', 'アップロードに失敗しました')
        }
      } catch {
        showToast('error', 'アップロードに失敗しました')
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [fetchImages]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setDragOver(false)
      if (e.dataTransfer.files.length > 0) {
        void uploadFiles(e.dataTransfer.files)
      }
    },
    [uploadFiles]
  )

  const handleDelete = async (id: string) => {
    if (!confirm('この画像を削除しますか？')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/image-library?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setImages((prev) => prev.filter((img) => img.id !== id))
      showToast('success', '削除しました')
    } catch {
      showToast('error', '削除に失敗しました')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDownload = (entry: ImageEntry) => {
    const a = document.createElement('a')
    a.href = entry.url
    a.download = `${entry.title || 'image'}.jpg`
    a.click()
  }

  return (
    <div className="w-full max-w-[1200px] mx-auto pb-16">
      <SectionTabs
        label="資料・画像管理"
        tabs={[
          { href: '/materials', label: '資料更新' },
          { href: '/images', label: '画像' },
        ]}
      />
      {/* ─── Toast ─── */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-[14px] text-[14px] font-semibold shadow-xl"
          style={{
            background: toast.type === 'success' ? 'rgba(16,185,129,0.96)' : 'rgba(239,68,68,0.96)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* ─── Lightbox ─── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] rounded-[18px] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt=""
              className="block max-w-[88vw] max-h-[82vh] object-contain"
            />
            <button
              onClick={() => setLightbox(null)}
              className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
              style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ─── Header ─── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
            }}
          >
            <Images size={18} color="#fff" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-[22px] font-black text-[#0f172a] leading-none">画像ライブラリ</h1>
            <p className="text-[13px] text-[#64748b] mt-0.5">
              生成・アップロードした画像を一元管理
            </p>
          </div>
        </div>

        <button
          onClick={() => void fetchImages()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-[11px] text-[13px] font-semibold transition-all"
          style={{
            background: 'rgba(255,255,255,0.9)',
            border: '1px solid rgba(15,23,42,0.12)',
            color: '#0f172a',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          更新
        </button>
      </div>

      {/* ─── Drop zone ─── */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault()
          dragCounter.current++
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          dragCounter.current--
          if (dragCounter.current <= 0) {
            dragCounter.current = 0
            setDragOver(false)
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center gap-3 py-10 px-6 rounded-[18px] cursor-pointer transition-all duration-200 mb-8"
        style={{
          background: dragOver
            ? 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.12))'
            : 'rgba(255,255,255,0.7)',
          border: dragOver
            ? '2px dashed #6366f1'
            : '2px dashed rgba(99,102,241,0.35)',
          boxShadow: dragOver ? '0 8px 28px rgba(99,102,241,0.2)' : '0 2px 12px rgba(0,0,0,0.04)',
          transform: dragOver ? 'scale(1.01)' : 'scale(1)',
        }}
      >
        <div
          className="w-12 h-12 rounded-[14px] flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
          }}
        >
          {uploading ? (
            <Loader2 size={22} color="#fff" className="animate-spin" />
          ) : (
            <ImagePlus size={22} color="#fff" />
          )}
        </div>
        <div className="text-center">
          <p className="text-[15px] font-bold text-[#0f172a]">
            {uploading
              ? 'アップロード中...'
              : dragOver
                ? 'ここにドロップして追加'
                : '画像をドラッグ＆ドロップ'}
          </p>
          <p className="text-[12px] text-[#94a3b8] mt-1">
            またはクリックしてファイルを選択（複数可）
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files)
          }}
        />
      </div>

      {/* ─── Stats bar ─── */}
      <div
        className="flex items-center gap-6 px-6 py-4 rounded-[16px] mb-8"
        style={{
          background: 'rgba(255,255,255,0.85)',
          border: '1px solid rgba(15,23,42,0.09)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
        }}
      >
        <Stat label="合計" value={images.length} color="#6366f1" />
        <div style={{ width: 1, height: 32, background: 'rgba(15,23,42,0.08)' }} />
        <Stat
          label="AI生成"
          value={images.filter((i) => i.source === 'generated').length}
          color="#0ea5e9"
        />
        <div style={{ width: 1, height: 32, background: 'rgba(15,23,42,0.08)' }} />
        <Stat
          label="アップロード"
          value={images.filter((i) => i.source === 'uploaded').length}
          color="#10b981"
        />
      </div>

      {/* ─── Grid ─── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Loader2 size={36} className="animate-spin" style={{ color: '#6366f1' }} />
          <p className="text-[14px] text-[#64748b]">読み込み中...</p>
        </div>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div
            className="w-16 h-16 rounded-[18px] flex items-center justify-center"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}
          >
            <ImageOff size={28} style={{ color: '#6366f1', opacity: 0.5 }} />
          </div>
          <p className="text-[15px] font-semibold text-[#64748b]">まだ画像がありません</p>
          <p className="text-[13px] text-[#94a3b8] text-center max-w-xs">
            記事作成のStep 3で画像を生成すると自動的にここに追加されます。
            上のボックスから手動アップロードもできます。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {images.map((entry) => (
            <ImageCard
              key={entry.id}
              entry={entry}
              deleting={deletingId === entry.id}
              onLightbox={() => setLightbox(entry)}
              onDownload={() => handleDownload(entry)}
              onDelete={() => void handleDelete(entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-2 h-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}60` }}
      />
      <span className="text-[13px] text-[#64748b]">{label}</span>
      <span className="text-[18px] font-black" style={{ color }}>
        {value}
      </span>
    </div>
  )
}

function ImageCard({
  entry,
  deleting,
  onLightbox,
  onDownload,
  onDelete,
}: {
  entry: ImageEntry
  deleting: boolean
  onLightbox: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  const [imgError, setImgError] = useState(false)

  return (
    <div
      className="group relative rounded-[16px] overflow-hidden transition-all duration-200"
      style={{
        background: 'rgba(255,255,255,0.95)',
        border: '1px solid rgba(15,23,42,0.09)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}
    >
      {/* Image area */}
      <div
        className="relative w-full cursor-pointer overflow-hidden"
        style={{ paddingBottom: '56.25%' /* 16:9 */ }}
        onClick={onLightbox}
      >
        {imgError ? (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(99,102,241,0.06)' }}
          >
            <ImageOff size={24} style={{ color: '#94a3b8' }} />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.url}
            alt=""
            loading="lazy"
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}

        {/* Hover overlay */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        >
          <ZoomIn size={24} color="#fff" />
        </div>

        {/* Source badge */}
        <div
          className="absolute top-2 left-2 px-2 py-0.5 rounded-[6px] text-[10px] font-bold"
          style={{
            background:
              entry.source === 'generated' ? 'rgba(14,165,233,0.9)' : 'rgba(16,185,129,0.9)',
            color: '#fff',
          }}
        >
          {entry.source === 'generated' ? 'AI生成' : 'アップロード'}
        </div>
      </div>

      {/* Actions only */}
      <div className="flex items-center justify-center gap-2 px-3 py-2.5">
        <ActionBtn onClick={onDownload} title="ダウンロード" color="#0ea5e9">
          <Download size={14} />
        </ActionBtn>
        <ActionBtn onClick={onDelete} title="削除" color="#ef4444" disabled={deleting}>
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </ActionBtn>
      </div>
    </div>
  )
}

function ActionBtn({
  children,
  onClick,
  title,
  color,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  color: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex-1 h-9 rounded-[9px] flex items-center justify-center transition-colors disabled:opacity-50"
      style={{ background: `${color}14`, color }}
    >
      {children}
    </button>
  )
}
