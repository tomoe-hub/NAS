'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
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
} from 'lucide-react'
import type { ImageEntry } from '@/lib/imageLibrary'

export default function ImagesPage() {
  const [images, setImages] = useState<ImageEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [lightbox, setLightbox] = useState<ImageEntry | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('error', '画像ファイルを選択してください')
      return
    }
    setUploading(true)
    try {
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
      if (!res.ok) throw new Error('保存失敗')
      showToast('success', '画像をアップロードしました')
      await fetchImages()
    } catch {
      showToast('error', 'アップロードに失敗しました')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

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
    a.download = `${entry.title ?? 'image'}.jpg`
    a.target = '_blank'
    a.click()
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  }

  return (
    <div className="w-full max-w-[1200px] mx-auto pb-16">
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
          {toast.type === 'success' ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
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
              alt={lightbox.title}
              className="block max-w-[88vw] max-h-[82vh] object-contain"
            />
            <div
              className="absolute bottom-0 left-0 right-0 px-5 py-4"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)' }}
            >
              <div className="text-white font-semibold text-[15px] truncate">{lightbox.title}</div>
              {lightbox.targetKeyword && (
                <div className="text-white/60 text-[12px] mt-0.5">{lightbox.targetKeyword}</div>
              )}
            </div>
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
      <div className="flex items-center justify-between mb-8">
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

        <div className="flex items-center gap-2">
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

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-[11px] text-[13px] font-semibold transition-all"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff',
              boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
            }}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            画像をアップロード
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
        </div>
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
            また右上のボタンから手動でアップロードもできます。
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
              formatDate={formatDate}
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
  formatDate,
}: {
  entry: ImageEntry
  deleting: boolean
  onLightbox: () => void
  onDownload: () => void
  onDelete: () => void
  formatDate: (iso: string) => string
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={entry.url}
            alt={entry.title}
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
              entry.source === 'generated'
                ? 'rgba(14,165,233,0.9)'
                : 'rgba(16,185,129,0.9)',
            color: '#fff',
          }}
        >
          {entry.source === 'generated' ? 'AI生成' : 'アップロード'}
        </div>
      </div>

      {/* Info + Actions */}
      <div className="px-3 py-3">
        <p
          className="text-[13px] font-semibold text-[#0f172a] leading-snug mb-1 line-clamp-2"
          title={entry.title}
        >
          {entry.title}
        </p>
        {entry.targetKeyword && (
          <p className="text-[11px] text-[#6366f1] font-medium truncate mb-1">
            {entry.targetKeyword}
          </p>
        )}
        <p className="text-[11px] text-[#94a3b8]">{formatDate(entry.createdAt)}</p>

        <div className="flex items-center gap-1.5 mt-2.5">
          <ActionBtn onClick={onDownload} title="ダウンロード" color="#0ea5e9">
            <Download size={13} />
          </ActionBtn>
          <ActionBtn
            onClick={onDelete}
            title="削除"
            color="#ef4444"
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Trash2 size={13} />
            )}
          </ActionBtn>
        </div>
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
      className="w-8 h-8 rounded-[8px] flex items-center justify-center transition-colors disabled:opacity-50"
      style={{ background: `${color}18`, color }}
    >
      {children}
    </button>
  )
}
