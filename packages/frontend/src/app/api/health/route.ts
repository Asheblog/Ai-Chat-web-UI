import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/app-meta';

export async function GET() {
  try {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'aichat-frontend',
      version: APP_VERSION,
      environment: process.env.NODE_ENV || 'unknown',
      uptime: process.uptime()
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Health check failed',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
