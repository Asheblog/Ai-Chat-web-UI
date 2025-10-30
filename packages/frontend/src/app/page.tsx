// 基于 Cookie 的会话：在服务端判断登录态并进行重定向
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function HomePage() {
  redirect('/main')
}
