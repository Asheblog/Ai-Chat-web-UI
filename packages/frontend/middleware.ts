import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// 基于 Cookie 的服务端重定向：
// - 受保护路由 /main* 无 Cookie 则跳转登录
// - 登录/注册页在已登录时跳转到 /main
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const hasToken = !!req.cookies.get('token')?.value

  // 受保护区域
  if (pathname.startsWith('/main')) {
    if (!hasToken) {
      const url = req.nextUrl.clone()
      url.pathname = '/auth/login'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  // 认证页面在已登录时跳转
  if (pathname === '/' || pathname.startsWith('/auth/login') || pathname.startsWith('/auth/register')) {
    if (hasToken) {
      const url = req.nextUrl.clone()
      url.pathname = '/main'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/main/:path*', '/auth/login', '/auth/register', '/'],
}

