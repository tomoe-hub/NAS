import { redirect } from 'next/navigation'

/** 旧URL互換: /keywords → /library のキーワードタブへ */
export default function KeywordsRedirect() {
  redirect('/library?tab=keywords')
}
