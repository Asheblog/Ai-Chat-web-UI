/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  transpilePackages: ['@aichat/shared'],

  // 启用standalone模式，优化Docker部署
  output: 'standalone',

  // 优化构建性能
  compress: true,
  poweredByHeader: false,

  // 环境变量配置
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001/api',
  },

  // API代理配置（开发环境）
  async rewrites() {
    // 直接将前端 /api/* 代理到后端的 NEXT_PUBLIC_API_URL（通常形如 http://host:8001/api）
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001/api'
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/:path*`,
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
