import { ApiResponse } from './types';

export function okResponse<T>(result: T, startTime?: number): ApiResponse<T> {
  return {
    status: 'ok',
    result,
    time: startTime ? (Date.now() - startTime) / 1000 : undefined,
  };
}

export function errorResponse(
  code: string,
  message: string,
  startTime?: number,
): ApiResponse<never> {
  return {
    status: 'error',
    error: { code, message },
    time: startTime ? (Date.now() - startTime) / 1000 : undefined,
  };
}
