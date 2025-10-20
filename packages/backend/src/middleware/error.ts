import { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const errorHandler = (error: Error, c: Context) => {
  console.error('API Error:', error);

  // 默认错误响应
  let status = 500;
  let message = 'Internal server error';

  // 根据错误类型设置不同的响应
  if (error.name === 'ValidationError') {
    status = 400;
    message = error.message;
  } else if (error.name === 'UnauthorizedError') {
    status = 401;
    message = 'Unauthorized';
  } else if (error.name === 'ForbiddenError') {
    status = 403;
    message = 'Forbidden';
  } else if (error.name === 'NotFoundError') {
    status = 404;
    message = 'Resource not found';
  } else if (error.message.includes('Prisma')) {
    // Prisma相关错误
    if (error.message.includes('Unique constraint')) {
      status = 409;
      message = 'Resource already exists';
    } else if (error.message.includes('Foreign key constraint')) {
      status = 400;
      message = 'Invalid reference';
    }
  }

  return c.json(
    {
      success: false,
      error: message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    },
    status as ContentfulStatusCode
  );
};

export const notFoundHandler = (c: Context) => {
  return c.json(
    {
      success: false,
      error: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404 as ContentfulStatusCode
  );
};
