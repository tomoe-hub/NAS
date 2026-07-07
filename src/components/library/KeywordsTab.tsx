'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, X, Check, Loader2 } from 'lucide-react'
import { SavedKeyword, getAllKeywords, saveKeyword, deleteKeyword, migrateOldLocalStorageToS3 } from '@/lib/keywordStorage'
import Button from '@/components/ui/Button'

/** キーワードライブラリ（S3保存）。/library の「キーワード」タブ */
export default function KeywordsTab() {
  const [keywords, setKeywords] = useState<SavedKeyword[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SavedKeyword | null>(null)

  useEffect(() => {
    void (async () => {
      // 旧 localStorage からのマイグレーション（初回のみ）
      await migrateOldLocalStorageToS3()
      const kws = await getAllKeywords()
      setKeywords(kws)
      setLoading(false)
    })()
  }, [])

  const handleCreateNew = () => {
    setIsCreating(true)
    setEditingId(null)
    setEditTitle('')
    setEditContent('')
  }

  const handleEdit = (k: SavedKeyword) => {
    setIsCreating(false)
    setEditingId(k.id)
    setEditTitle(k.title)
    setEditContent(k.content)
  }

  const handleCancel = () => {
    setIsCreating(false)
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!editTitle.trim() || !editContent.trim()) return
    setSaving(true)
    try {
      const updated = await saveKeyword({
        id: editingId ?? undefined,
        title: editTitle.trim(),
        content: editContent.trim(),
      })
      setKeywords(updated)
    } finally {
      setSaving(false)
      setIsCreating(false)
      setEditingId(null)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      const updated = await deleteKeyword(deleteTarget.id)
      setKeywords(updated)
      if (editingId === deleteTarget.id) {
        setEditingId(null)
        setIsCreating(false)
      }
    } finally {
      setSaving(false)
      setDeleteTarget(null)
    }
  }

  const isEditorOpen = isCreating || editingId !== null

  const nasInput = 'w-full px-4 py-2.5 rounded-[10px] text-sm transition-all duration-150 outline-none'
  const nasInputStyle = {
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.92)',
    color: 'var(--ink)',
    boxShadow: 'inset 0 1px 3px rgba(20,44,92,0.05)',
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          よく使うキーワードセットを保存・管理します。クラウド保存で端末をまたいで利用できます。
        </p>
        {!isEditorOpen && (
          <Button variant="primary" onClick={handleCreateNew}>
            <Plus size={16} />
            キーワードを追加
          </Button>
        )}
      </div>

      {/* Editor */}
      {isEditorOpen && (
        <div
          className="rounded-[16px] p-6 mb-6"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>
              {isCreating ? '新しいキーワードセット' : 'キーワードセットを編集'}
            </h2>
            <button
              type="button"
              onClick={handleCancel}
              className="p-1.5 rounded-[8px] transition-colors hover:bg-[rgba(20,44,92,0.06)]"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={18} />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
                セット名（用途など）
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="例：事業承継コラム用"
                className={nasInput}
                style={nasInputStyle}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
                ターゲットキーワード（カンマ区切り）
              </label>
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                placeholder="例：事業承継 M&A, 中小企業 事業承継, 後継者不足"
                className={`${nasInput} resize-y min-h-[120px]`}
                style={nasInputStyle}
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={handleCancel}>キャンセル</Button>
              <Button
                variant="primary"
                disabled={!editTitle.trim() || !editContent.trim() || saving}
                onClick={() => void handleSave()}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                保存する
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div
            className="rounded-[16px] p-12 flex items-center justify-center gap-3"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}
          >
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--primary)' }} />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>読み込み中...</span>
          </div>
        ) : keywords.length === 0 && !isEditorOpen ? (
          <div
            className="rounded-[16px] p-14 text-center"
            style={{ background: 'var(--surface-raised)', border: '1.5px dashed var(--border)' }}
          >
            <p className="font-medium mb-1" style={{ color: 'var(--text-muted)' }}>保存されているキーワードセットはありません</p>
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>上の「キーワードを追加」から最初のセットを作成してください</p>
          </div>
        ) : (
          keywords.map(k => (
            <div
              key={k.id}
              className="group rounded-[14px] p-5 transition-all duration-150 hover:-translate-y-px"
              style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)' }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 pr-4">
                  <h3 className="font-bold text-base mb-2" style={{ color: 'var(--ink)' }}>{k.title}</h3>
                  <p className="text-sm whitespace-pre-wrap line-clamp-3" style={{ color: 'var(--text-muted)' }}>{k.content}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleEdit(k)}
                    className="p-2 rounded-[8px] transition-colors hover:bg-[rgba(18,103,242,0.08)]"
                    style={{ color: 'var(--text-muted)' }}
                    title="編集"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(k)}
                    className="p-2 rounded-[8px] transition-colors hover:bg-red-50"
                    style={{ color: 'var(--danger)' }}
                    title="削除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center"
          style={{ background: 'rgba(10,20,50,0.45)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="rounded-[18px] max-w-md w-full mx-4 p-6"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-bold mb-1" style={{ color: 'var(--ink)' }}>このキーワードセットを削除しますか？</h2>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {`「${deleteTarget.title.slice(0, 30)}${deleteTarget.title.length > 30 ? '…' : ''}」を削除します。`}
                </p>
              </div>
              <button type="button" onClick={() => setDeleteTarget(null)} className="p-1.5 rounded-[8px] transition-colors hover:bg-[rgba(20,44,92,0.06)]" style={{ color: 'var(--text-muted)' }}>
                <X size={16} />
              </button>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>キャンセル</Button>
              <Button variant="destructive" disabled={saving} onClick={() => void handleConfirmDelete()}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                削除する
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
