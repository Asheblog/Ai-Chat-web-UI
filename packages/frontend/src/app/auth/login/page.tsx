export const dynamic = 'force-dynamic'

import { getServerBranding } from '@/lib/server-branding'
import LoginPageClient from './login-client'

export default async function LoginPage() {
  const branding = await getServerBranding()
  return <LoginPageClient initialBrandText={branding.text} />
}
