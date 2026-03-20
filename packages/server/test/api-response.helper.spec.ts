import { okResponse, errorResponse } from '../src/shared/api-response.helper';

describe('api-response.helper', () => {
  describe('okResponse', () => {
    it('should wrap result with ok status', () => {
      const response = okResponse({ id: '1' });
      expect(response.status).toBe('ok');
      expect(response.result).toEqual({ id: '1' });
    });

    it('should include time when startTime is provided', () => {
      const startTime = Date.now() - 100;
      const response = okResponse('data', startTime);
      expect(response.time).toBeDefined();
      expect(response.time).toBeGreaterThan(0);
    });

    it('should set time to undefined when startTime is omitted', () => {
      const response = okResponse('data');
      expect(response.time).toBeUndefined();
    });

    it('should handle null result', () => {
      const response = okResponse(null);
      expect(response.status).toBe('ok');
      expect(response.result).toBeNull();
    });

    it('should handle array result', () => {
      const response = okResponse([1, 2, 3]);
      expect(response.result).toEqual([1, 2, 3]);
    });
  });

  describe('errorResponse', () => {
    it('should wrap error with error status', () => {
      const response = errorResponse('NOT_FOUND', 'Resource not found');
      expect(response.status).toBe('error');
      expect(response.error).toEqual({ code: 'NOT_FOUND', message: 'Resource not found' });
    });

    it('should include time when startTime is provided', () => {
      const startTime = Date.now() - 50;
      const response = errorResponse('ERR', 'fail', startTime);
      expect(response.time).toBeDefined();
      expect(response.time).toBeGreaterThan(0);
    });

    it('should set time to undefined when startTime is omitted', () => {
      const response = errorResponse('ERR', 'fail');
      expect(response.time).toBeUndefined();
    });
  });
});
