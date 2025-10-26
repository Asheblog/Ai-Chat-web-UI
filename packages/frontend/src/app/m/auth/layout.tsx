import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function MobileAuthLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get('token')?.value
  if (token) redirect('/m/main')
  return <>{children}</>
}

