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
  const secChUaMobile = req.headers.get('sec-ch-ua-mobile')
  const headerSuggestsMobile = secChUaMobile === '?1'
  const uaValue = req.headers.get('user-agent') || ''
  const uaStringSuggestsMobile = /\b(Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Silk)\b/i.test(uaValue)
  const uaIsMobile = deviceType === 'mobile' || deviceType === 'tablet'
  const detectedMobile = uaIsMobile || headerSuggestsMobile || uaStringSuggestsMobile
  const override = req.cookies.get('viewMode')?.value as 'mobile'|'desktop'|undefined
  // viewMode Cookie 优先，其次结合 UA 解析结果与请求头回退判断移动端
  const isMobile = override === 'mobile' ? true : override === 'desktop' ? false : detectedMobile
  const isMobileRoute = pathname.startsWith('/m')

  // 受保护区域
  // /main 与 /m/main 统一鉴权
  if (pathname.startsWith('/main') || pathname.startsWith('/m/main')) {
    if (!hasToken) {
      const url = req.nextUrl.clone()
      url.pathname = isMobile ? '/m/auth/login' : '/auth/login'
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

  // 根路径与认证页面：
  // - 已登录：根据端类型跳转到对应主页
  // - 未登录：根据端类型跳转到对应的登录/注册页（修复：移动端访问根路径不会自动跳到 /m）
  if (
    pathname === '/' ||
    pathname.startsWith('/auth/login') ||
    pathname.startsWith('/auth/register')
  ) {
    const url = req.nextUrl.clone()
    if (hasToken) {
      url.pathname = isMobile ? '/m/main' : '/main'
      url.search = ''
      return NextResponse.redirect(url)
    }
    // 未登录时的端间跳转
    // 从桌面认证页到移动认证页
    if (!isMobileRoute && isMobile) {
      if (pathname.startsWith('/auth/register')) {
        url.pathname = '/m/auth/register'
      } else {
        // 对于根路径和 /auth/login 统一跳转到移动端登录
        url.pathname = '/m/auth/login'
      }
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  // 移动端认证页：
  // - 已登录：跳转移动端主页
  // - 在非移动端且未强制 mobile（viewMode≠mobile）时，跳转到桌面认证页，避免误入
  if (pathname.startsWith('/m/auth/login') || pathname.startsWith('/m/auth/register')) {
    const url = req.nextUrl.clone()
    if (hasToken) {
      url.pathname = '/m/main'
      url.search = ''
      return NextResponse.redirect(url)
    }
    if (!isMobile) {
      url.pathname = pathname.replace(/^\/m\//, '/').replace(/^auth\//, '/auth/')
      // 保险：若上面的替换不符合预期，则显式回落到登录页
      if (!url.pathname.startsWith('/auth/')) url.pathname = '/auth/login'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/main/:path*', '/m/:path*', '/auth/login', '/auth/register', '/'],
}
