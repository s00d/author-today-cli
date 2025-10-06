import { Logger } from './logger';

export class RateLimiter {
  private lastRequestTime = 0;
  private minInterval: number;

  constructor(minIntervalMs: number = 2000) {
    this.minInterval = minIntervalMs;
  }

  /**
   * Ждать перед следующим запросом, если нужно
   */
  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastRequest;
      Logger.verbose(`Rate limit: ждем ${waitTime}ms перед следующим запросом`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Выполнить запрос с обработкой rate limiting
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 2000
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Всегда ждем перед запросом, если прошло меньше 2 секунд
        await this.waitIfNeeded();
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // Проверяем, является ли это ошибкой rate limiting
        const isRateLimitError = error?.response?.status === 429 || 
                                error?.response?.data?.code === 'TooManyRequests' ||
                                error?.message?.includes('Too many requests');
        
        if (isRateLimitError && attempt < maxRetries) {
          const retryAfter = error?.response?.data?.retryAfter || 5;
          const delay = Math.max(retryAfter * 1000, baseDelay * Math.pow(2, attempt - 1));
          
          Logger.warn(`Rate limit превышен, попытка ${attempt}/${maxRetries}`);
          Logger.verbose(`Ждем ${delay}ms перед повторной попыткой...`);
          
          // Устанавливаем время последнего запроса, чтобы учесть время ожидания
          this.lastRequestTime = Date.now() + delay;
          
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Если это не rate limit ошибка или это последняя попытка, пробрасываем ошибку
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * Обработать ошибку rate limiting
   */
  static handleRateLimitError(error: any): void {
    if (error?.response?.status === 429) {
      const retryAfter = error?.response?.data?.retryAfter || 5;
      Logger.error('Превышен лимит запросов к API');
      Logger.warn(`Попробуйте снова через ${retryAfter} секунд`);
    } else if (error?.response?.data?.code === 'TooManyRequests') {
      Logger.error('Слишком много запросов');
      Logger.warn('Попробуйте снова через несколько секунд');
    }
  }
}
