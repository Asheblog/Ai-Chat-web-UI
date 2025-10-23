// 基于 Cookie 的会话：在服务端判断登录态并进行重定向
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export default function HomePage() {
  const token = cookies().get('token')?.value
  if (token) redirect('/main')
  redirect('/auth/login')
}
