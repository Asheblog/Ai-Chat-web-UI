import type { NextRequest } from 'next/server'
import { NextResponse, userAgent } from 'next/server'

// 基于 Cookie 的服务端重定向：
// - 受保护路由 /main* 无 Cookie 则跳转登录
// - 登录/注册页在已登录时跳转到 /main
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const hasToken = !!req.cookies.get('token')?.value
  const ua = userAgent(req)
  const deviceType = ua.device.type // 'mobile' | 'tablet' | 'desktop' | undefined
  const uaIsMobile = deviceType === 'mobile' || deviceType === 'tablet'
  const override = req.cookies.get('viewMode')?.value as 'mobile'|'desktop'|undefined
  const isMobile = override === 'mobile' ? true : override === 'desktop' ? false : uaIsMobile
  const isMobileRoute = pathname.startsWith('/m')

  // 受保护区域
  // /main 与 /m/main 统一鉴权
  if (pathname.startsWith('/main') || pathname.startsWith('/m/main')) {
    if (!hasToken) {
      const url = req.nextUrl.clone()
      url.pathname = '/auth/login'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  // 设备自适应重定向：
  // - 移动/平板访问 /main* 时跳转到 /m/main*
  // - 桌面访问 /m/main* 时跳回 /main*
  if (pathname.startsWith('/main') && isMobile) {
    const url = req.nextUrl.clone()
    url.pathname = '/m' + pathname
    return NextResponse.redirect(url)
  }
  if (pathname.startsWith('/m/main') && !isMobile) {
    const url = req.nextUrl.clone()
    url.pathname = pathname.replace(/^\/m/, '')
    return NextResponse.redirect(url)
  }

  // 认证页面在已登录时跳转
  if (pathname === '/' || pathname.startsWith('/auth/login') || pathname.startsWith('/auth/register')) {
    if (hasToken) {
      const url = req.nextUrl.clone()
      url.pathname = isMobile ? '/m/main' : '/main'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  // 已登录访问移动端认证页 → 跳转 /m/main
  if (pathname.startsWith('/m/auth/login') || pathname.startsWith('/m/auth/register')) {
    if (hasToken) {
      const url = req.nextUrl.clone()
      url.pathname = '/m/main'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/main/:path*', '/m/:path*', '/auth/login', '/auth/register', '/'],
}
