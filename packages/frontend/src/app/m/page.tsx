// 进入 /m 时重定向到 /m/main
import { redirect } from 'next/navigation'

export default function MobileRoot() {
  redirect('/m/main')
}

