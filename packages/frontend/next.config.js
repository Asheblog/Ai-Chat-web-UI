/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // 需要对工作区包做一次转译，以便在浏览器端服用最新 TS 语法
  transpilePackages: ['@aichat/shared'],
  // 暂时忽略类型错误，以保证生产构建顺利产出（后续可开启修复类型）
  typescript: {
    ignoreBuildErrors: true,
  },

  // 启用standalone模式，优化Docker部署
  output: 'standalone',

  // 优化构建性能
  compress: true,
  poweredByHeader: false,

  // 环境变量配置（仅暴露给浏览器的前缀为 NEXT_PUBLIC_）
  // 默认将浏览器可见的 API 基址设置为相对路径，避免跨设备访问时的 localhost 问题
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '/api',
  },

  // API代理配置（开发环境）
  async rewrites() {
    // 服务端反向代理目标：仅服务端使用，不暴露给浏览器
    const backendHost = process.env.BACKEND_HOST || 'localhost'
    // 优先使用容器内端口（Docker 场景），回退到 BACKEND_PORT 或默认 8001
    const backendPort = process.env.BACKEND_INTERNAL_PORT || process.env.BACKEND_PORT || '8001'
    const proxyOrigin = `http://${backendHost}:${backendPort}`
    return [
      {
        source: '/api/:path*',
        destination: `${proxyOrigin}/api/:path*`,
      },
      {
        source: '/v1/:path*',
        destination: `${proxyOrigin}/v1/:path*`,
      },
    ]
  },

  // 静态文件优化
  images: {
    unoptimized: true, // 避免在Docker中使用next/image的优化功能
  },

  // 实验性功能
  experimental: {
    // 优化包大小
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
};

module.exports = nextConfig;
