export const dynamic = 'force-dynamic'

import { getServerBranding } from '@/lib/server-branding'
import RegisterPageClient from './register-client'

export default async function RegisterPage() {
  const branding = await getServerBranding()
  return <RegisterPageClient initialBrandText={branding.text} />
}
