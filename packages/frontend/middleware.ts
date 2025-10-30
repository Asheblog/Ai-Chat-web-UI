import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// 统一路由：移除 /m 前缀并在服务端进行鉴权判断
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const hasToken = Boolean(req.cookies.get('token')?.value)

  // 兼容旧版 /m/* 路径，统一重定向到新的自适应路由
  if (pathname === '/m' || pathname === '/m/') {
    const url = req.nextUrl.clone()
    url.pathname = '/main'
    url.search = ''
    return NextResponse.redirect(url)
  }
  if (pathname.startsWith('/m/')) {
    const url = req.nextUrl.clone()
    const target = pathname.replace(/^\/m/, '') || '/'
    url.pathname = target.startsWith('/') ? target : `/${target}`
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith('/main')) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/auth/login') || pathname.startsWith('/auth/register')) {
    if (hasToken) {
      const url = req.nextUrl.clone()
      url.pathname = '/main'
      url.search = ''
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  if (pathname === '/') {
    const url = req.nextUrl.clone()
    url.pathname = hasToken ? '/main' : '/main'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/main/:path*', '/m/:path*', '/auth/login', '/auth/register', '/'],
}
