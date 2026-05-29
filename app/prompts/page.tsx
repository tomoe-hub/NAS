'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import { SavedPrompt, getAllPrompts, savePrompt, deletePrompt } from '@/lib/promptStorage'
import Button from '@/components/ui/Button'

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SavedPrompt | null>(null)

  useEffect(() => {
    setPrompts(getAllPrompts())
    setMounted(true)
  }, [])

  if (!mounted) return null

  const handleCreateNew = () => {
    setIsCreating(true)
    setEditingId(null)
    setEditTitle('')
    setEditContent('')
  }

  const handleEdit = (p: SavedPrompt) => {
    setIsCreating(false)
    setEditingId(p.id)
    setEditTitle(p.title)
    setEditContent(p.content)
  }

  const handleCancel = () => {
    setIsCreating(false)
    setEditingId(null)
  }

  const handleSave = () => {
    if (!editTitle.trim() || !editContent.trim()) return
    savePrompt({
      id: editingId || undefined,
      title: editTitle.trim(),
      content: editContent.trim(),
    })
    setPrompts(getAllPrompts())
    setIsCreating(false)
    setEditingId(null)
  }

  const handleRequestDelete = (p: SavedPrompt) => {
    setDeleteTarget(p)
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    deletePrompt(deleteTarget.id)
    setPrompts(getAllPrompts())
    if (editingId === deleteTarget.id) {
      setEditingId(null)
      setIsCreating(false)
    }
    setDeleteTarget(null)
  }

  const handleCloseDeleteModal = () => {
    setDeleteTarget(null)
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
    <div className="w-full py-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs font-bold tracking-[0.11em] uppercase mb-1" style={{ color: 'var(--primary)' }}>
            Prompt Library
          </p>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>プロンプトライブラリ</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            よく使うプロンプトを保存して、一次執筆でいつでも呼び出せます
          </p>
        </div>
        {!isEditorOpen && (
          <Button variant="primary" onClick={handleCreateNew}>
            <Plus size={16} />
            プロンプトを追加
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
              {isCreating ? '新しいプロンプト' : 'プロンプトを編集'}
            </h2>
            <button
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
                プロンプト名（用途など）
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="例：導入事例インタビュー用"
                className={nasInput}
                style={nasInputStyle}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
                プロンプト本文
              </label>
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                placeholder="AIへの指示内容を入力してください"
                className={`${nasInput} resize-y min-h-[200px]`}
                style={nasInputStyle}
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={handleCancel}>キャンセル</Button>
              <Button
                variant="primary"
                disabled={!editTitle.trim() || !editContent.trim()}
                onClick={handleSave}
              >
                <Check size={16} />
                保存する
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-3">
        {prompts.length === 0 && !isEditorOpen ? (
          <div
            className="rounded-[16px] p-14 text-center"
            style={{ background: 'var(--surface-raised)', border: '1.5px dashed var(--border)' }}
          >
            <p className="font-medium mb-1" style={{ color: 'var(--text-muted)' }}>保存されているプロンプトはありません</p>
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>上の「プロンプトを追加」から最初のテンプレートを作成してください</p>
          </div>
        ) : (
          prompts.map(p => (
            <div
              key={p.id}
              className="group rounded-[14px] p-5 transition-all duration-150 hover:-translate-y-px"
              style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)' }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 pr-4">
                  <h3 className="font-bold text-base mb-2" style={{ color: 'var(--ink)' }}>{p.title}</h3>
                  <p className="text-sm whitespace-pre-wrap line-clamp-3" style={{ color: 'var(--text-muted)' }}>
                    {p.content}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEdit(p)}
                    className="p-2 rounded-[8px] transition-colors hover:bg-[rgba(18,103,242,0.08)]"
                    style={{ color: 'var(--text-muted)' }}
                    title="編集"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleRequestDelete(p)}
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
                <h2 className="text-base font-bold mb-1" style={{ color: 'var(--ink)' }}>
                  このプロンプトを削除しますか？
                </h2>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {`「${deleteTarget.title.slice(0, 30)}${deleteTarget.title.length > 30 ? '…' : ''}」を削除します。`}
                </p>
              </div>
              <button onClick={handleCloseDeleteModal} className="p-1.5 rounded-[8px] transition-colors hover:bg-[rgba(20,44,92,0.06)]" style={{ color: 'var(--text-muted)' }}>
                <X size={16} />
              </button>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={handleCloseDeleteModal}>キャンセル</Button>
              <Button variant="destructive" onClick={handleConfirmDelete}>削除する</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
