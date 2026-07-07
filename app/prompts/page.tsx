import { redirect } from 'next/navigation'

/** 旧URL互換: /prompts → /library のプロンプトタブへ */
export default function PromptsRedirect() {
  redirect('/library?tab=prompts')
}
