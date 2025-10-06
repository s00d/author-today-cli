import axios, { AxiosInstance } from 'axios';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { AudioBook, AudioChapter, WorkMetaInfo, UserLibraryInfo, ApiErrorResponse, Series, SeriesInfo } from '../types';
import { Logger } from '../utils/logger';
import { RateLimiter } from '../utils/rateLimiter';

export interface AccessToken {
  token: string;
  issued: string;
  expires: string;
  twoFactorEnabled?: boolean;
}

export interface LoginData {
  login: string;
  password: string;
  code?: string; // Код двухфакторной аутентификации (необязательный)
}

export interface ApiResponse<T> {
  data: T;
  status: number;
}

export class AuthorTodayAPI {
  private api: AxiosInstance;
  private baseURL = 'https://api.author.today';
  private accessToken?: string;
  private refreshToken?: string;
  private tokenFile: string;
  private rateLimiter: RateLimiter;
  private cliVersion: string;

  constructor(version: string = '1.0.0') {
    this.cliVersion = version;
    // Сохраняем токен в системной папке пользователя
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.config', 'author-today-cli');
    this.tokenFile = path.join(configDir, 'auth-token.json');
    
    // Создаем папку конфигурации если её нет
    fs.ensureDirSync(configDir);
    
    // Инициализируем rate limiter (минимум 2 секунды между запросами)
    this.rateLimiter = new RateLimiter(2000);
    
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'User-Agent': `AuthorToday-CLI/${this.cliVersion}`,
        'Accept': 'application/json',
      }
    });

    // Загружаем сохраненный токен синхронно при инициализации
    this.loadSavedTokenSync();

    // Добавляем интерцептор для автоматического обновления токена
    this.setupResponseInterceptor();
  }

  /**
   * Настройка интерцептора для автоматического обновления токена
   */
  private setupResponseInterceptor(): void {
    this.api.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // Проверяем, что это ошибка 401 и токен истек
        const errorData = error.response?.data as ApiErrorResponse;
        if (error.response?.status === 401 && 
            errorData?.code === 'ExpiredToken' && 
            !originalRequest._retry) {
          
          originalRequest._retry = true;

          try {
            console.log('Токен истек, обновляем...');
            const refreshResponse = await this.refreshTokenInternal();
            
            if (refreshResponse.data.token) {
              this.accessToken = refreshResponse.data.token;
              this.refreshToken = refreshResponse.data.token;
              this.setAuthHeader();
              await this.saveToken(refreshResponse.data);
              
              // Повторяем оригинальный запрос с новым токеном
              originalRequest.headers['Authorization'] = `Bearer ${this.accessToken}`;
              return this.api(originalRequest);
            }
          } catch (refreshError) {
            console.error('Не удалось обновить токен:', refreshError);
            this.clearTokens();
            throw refreshError;
          }
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Загрузить сохраненный токен синхронно
   */
  private loadSavedTokenSync(): void {
    try {
      if (fs.pathExistsSync(this.tokenFile)) {
        const tokenData = fs.readJSONSync(this.tokenFile);
        this.accessToken = tokenData.accessToken;
        this.refreshToken = tokenData.refreshToken;
        
        // Проверяем, не истек ли токен
        if (tokenData.expires && new Date(tokenData.expires) < new Date()) {
          console.log('Токен истек, требуется повторная авторизация');
          this.clearTokens();
        } else {
          this.setAuthHeader();
        }
      }
    } catch (error) {
      console.log('Не удалось загрузить сохраненный токен:', error);
    }
  }

  /**
   * Загрузить сохраненный токен (асинхронная версия для совместимости)
   */
  private async loadSavedToken(): Promise<void> {
    this.loadSavedTokenSync();
  }

  /**
   * Сохранить токен в файл
   */
  private async saveToken(tokenData: AccessToken): Promise<void> {
    try {
      const data = {
        accessToken: tokenData.token,
        refreshToken: tokenData.token, // В API Author Today refresh token = access token
        expires: tokenData.expires,
        issued: tokenData.issued
      };
      
      await fs.writeJSON(this.tokenFile, data, { spaces: 2 });
      console.log('Токен сохранен');
    } catch (error) {
      console.log('Не удалось сохранить токен');
    }
  }

  /**
   * Установить заголовок авторизации
   */
  private setAuthHeader(): void {
    if (this.accessToken) {
      this.api.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
    } else {
      this.api.defaults.headers.common['Authorization'] = 'Bearer guest';
    }
  }

  /**
   * Получить заголовки для запроса
   */
  private getHeaders(includeAuth = true): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': `AuthorToday-CLI/${this.cliVersion}`
    };

    if (includeAuth) {
      if (this.accessToken) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
      } else {
        headers['Authorization'] = 'Bearer guest';
      }
    }

    return headers;
  }

  /**
   * Очистить токены
   */
  private clearTokens(): void {
    this.accessToken = undefined;
    this.refreshToken = undefined;
    delete this.api.defaults.headers.common['Authorization'];
    
    // Удаляем файл с токеном
    if (fs.pathExistsSync(this.tokenFile)) {
      fs.unlinkSync(this.tokenFile);
    }
  }

  /**
   * Проверить авторизацию
   */
  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /**
   * Обновление токена
   */
  private async refreshTokenInternal(): Promise<ApiResponse<AccessToken>> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const headers = this.getHeaders(true);
      const response = await this.api.post<AccessToken>('/v1/account/refresh-token', {}, {
        headers: {
          ...headers,
          'Authorization': `Bearer ${this.refreshToken}`
        }
      });

      return {
        data: response.data,
        status: response.status
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { data?: { message?: string } } };
      console.error('Ошибка обновления токена:', axiosError.response?.data?.message || errorMessage);
      throw error;
    }
  }

  /**
   * Авторизация по логину и паролю
   */
  async login(loginData: LoginData): Promise<ApiResponse<AccessToken>> {
    try {
      Logger.verbose('Начинаем авторизацию...');
      // Для авторизации используем заголовки с guest токеном
      const headers = this.getHeaders(true);
      
      // Убираем пустой код из данных, если он не указан
      const dataToSend = { ...loginData };
      if (!dataToSend.code || dataToSend.code.trim() === '') {
        delete dataToSend.code;
      }
      
      Logger.http('POST', '/v1/account/login-by-password');
      const response = await this.rateLimiter.executeWithRetry(async () => {
        return await this.api.post('/v1/account/login-by-password', dataToSend, {
          headers
        });
      });
      
      Logger.apiResponse(response.status, '/v1/account/login-by-password');
      
      // Сохраняем токен только если он есть (успешная авторизация)
      if (response.data && response.data.token) {
        Logger.verbose('Токен получен, сохраняем...');
        this.accessToken = response.data.token;
        this.refreshToken = response.data.token;
        this.setAuthHeader();
        await this.saveToken(response.data);
        Logger.success('Авторизация успешна');
      }
      
      return {
        data: response.data,
        status: response.status
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { data?: ApiErrorResponse } };
      const apiError = axiosError.response?.data;
      
      if (apiError?.code === 'InvalidRequestFields' && apiError.invalidFields) {
        Logger.error('Ошибки валидации:');
        Object.entries(apiError.invalidFields).forEach(([field, messages]) => {
          Logger.error(`${field}: ${messages.join(', ')}`);
        });
      } else {
        Logger.error('Ошибка авторизации:', apiError?.message || errorMessage);
      }
      throw error;
    }
  }

  /**
   * Получить информацию о текущем пользователе
   */
  async getCurrentUser(): Promise<ApiResponse<Record<string, unknown>>> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.rateLimiter.executeWithRetry(async () => {
        return await this.api.get<Record<string, unknown>>('/v1/account/current-user', { headers });
      });
      return {
        data: response.data,
        status: response.status
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { status?: number; data?: { message?: string; code?: string } } };
      
      // Обрабатываем rate limiting ошибки
      if (axiosError.response?.status === 429 || axiosError.response?.data?.code === 'TooManyRequests') {
        RateLimiter.handleRateLimitError(axiosError);
      } else {
        Logger.error('Ошибка получения информации о пользователе:', axiosError.response?.data?.message || errorMessage);
      }
      
      throw error;
    }
  }

  /**
   * Получить список аудиокниг из библиотеки пользователя
   */
  async getAudioBooks(page = 1, pageSize = 500): Promise<AudioBook[]> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.rateLimiter.executeWithRetry(async () => {
        return await this.api.get<UserLibraryInfo>('/v1/account/user-library', {
          headers,
          params: {
            page,
            pageSize
          }
        });
      });

      // Фильтруем только аудиокниги (Format = 2 или 'Audiobook')
      const allBooks: WorkMetaInfo[] = response.data.worksInLibrary || [];
      const audioBooks: AudioBook[] = allBooks
        .filter((book: WorkMetaInfo) => book.format === 2 || book.format === 'Audiobook')
        .map((book: WorkMetaInfo): AudioBook => ({
          id: book.id,
          title: book.title,
          authorFIO: book.authorFIO || '',
          coverUrl: book.coverUrl,
          reciter: book.reciter,
          format: book.format,
          isFinished: book.isFinished,
          textLength: book.textLength,
          price: book.price,
          discount: book.discount,
          isPurchased: book.isPurchased,
          lastReadTime: book.lastReadTime,
          addedToLibraryTime: book.addedToLibraryTime,
          seriesTitle: book.seriesTitle,
          seriesOrder: book.seriesOrder
        }));
      
      return audioBooks;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { status?: number; data?: { message?: string; code?: string } } };
      
      // Обрабатываем rate limiting ошибки
      if (axiosError.response?.status === 429 || axiosError.response?.data?.code === 'TooManyRequests') {
        RateLimiter.handleRateLimitError(axiosError);
      } else {
        Logger.error('Ошибка получения списка аудиокниг:', axiosError.response?.data?.message || errorMessage);
      }
      
      throw error;
    }
  }

  /**
   * Поиск аудиокниг по запросу в библиотеке пользователя
   */
  async searchAudioBooks(query: string, page = 1, pageSize = 500): Promise<AudioBook[]> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.rateLimiter.executeWithRetry(async () => {
        return await this.api.get<UserLibraryInfo>('/v1/account/user-library', {
          headers,
          params: {
            page,
            pageSize
          }
        });
      });

      // Фильтруем только аудиокниги (Format = 2) и по поисковому запросу
      const allBooks: WorkMetaInfo[] = response.data.worksInLibrary || [];
      const audioBooks: AudioBook[] = allBooks
        .filter((book: WorkMetaInfo) => {
          const isAudioBook = book.format === 2 || book.format === 'Audiobook';
          const matchesQuery = !query || 
            book.title.toLowerCase().includes(query.toLowerCase()) ||
            (book.authorFIO && book.authorFIO.toLowerCase().includes(query.toLowerCase())) ||
            (book.reciter && book.reciter.toLowerCase().includes(query.toLowerCase()));
          
          return isAudioBook && matchesQuery;
        })
        .map((book: WorkMetaInfo): AudioBook => ({
          id: book.id,
          title: book.title,
          authorFIO: book.authorFIO || '',
          coverUrl: book.coverUrl,
          reciter: book.reciter,
          format: book.format,
          isFinished: book.isFinished,
          textLength: book.textLength,
          price: book.price,
          discount: book.discount,
          isPurchased: book.isPurchased,
          lastReadTime: book.lastReadTime,
          addedToLibraryTime: book.addedToLibraryTime,
          seriesTitle: book.seriesTitle,
          seriesOrder: book.seriesOrder
        }));
      
      return audioBooks;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { status?: number; data?: { message?: string; code?: string } } };
      
      // Обрабатываем rate limiting ошибки
      if (axiosError.response?.status === 429 || axiosError.response?.data?.code === 'TooManyRequests') {
        RateLimiter.handleRateLimitError(axiosError);
      } else {
        Logger.error('Ошибка поиска аудиокниг:', axiosError.response?.data?.message || errorMessage);
      }
      
      throw error;
    }
  }

  /**
   * Получить детали аудиокниги
   */
  async getAudioBookDetails(bookId: number): Promise<AudioBook | null> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.rateLimiter.executeWithRetry(async () => {
        return await this.api.get<AudioBook>(`/v1/work/${bookId}/details`, { headers });
      });
      return response.data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { status?: number; data?: { message?: string; code?: string } } };
      
      // Обрабатываем rate limiting ошибки
      if (axiosError.response?.status === 429 || axiosError.response?.data?.code === 'TooManyRequests') {
        RateLimiter.handleRateLimitError(axiosError);
      } else {
        Logger.error('Ошибка получения деталей аудиокниги:', axiosError.response?.data?.message || errorMessage);
      }
      
      return null;
    }
  }

  /**
   * Получить главы аудиокниги
   */
  async getAudioChapters(bookId: number): Promise<AudioChapter[]> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.rateLimiter.executeWithRetry(async () => {
        return await this.api.get<AudioChapter[]>(`/v1/audiobook/${bookId}/content`, { headers });
      });
      return response.data || [];
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { status?: number; data?: { message?: string; code?: string } } };
      
      // Обрабатываем rate limiting ошибки
      if (axiosError.response?.status === 429 || axiosError.response?.data?.code === 'TooManyRequests') {
        RateLimiter.handleRateLimitError(axiosError);
      } else {
        Logger.error('Ошибка получения глав аудиокниги:', axiosError.response?.data?.message || errorMessage);
      }
      
      return [];
    }
  }

  /**
   * Получить URL для скачивания аудиофайла главы
   */
  async getChapterAudioUrl(bookId: number, chapterId: number): Promise<string | null> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.rateLimiter.executeWithRetry(async () => {
        return await this.api.get<{ url: string }>(`/v1/audiobook/get-url/${bookId}/${chapterId}`, { headers });
      });
      return response.data.url || null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { status?: number; data?: { message?: string; code?: string } } };
      
      // Обрабатываем rate limiting ошибки
      if (axiosError.response?.status === 429 || axiosError.response?.data?.code === 'TooManyRequests') {
        RateLimiter.handleRateLimitError(axiosError);
      } else {
        Logger.error('Ошибка получения URL аудио:', axiosError.response?.data?.message || errorMessage);
      }
      
      return null;
    }
  }

  /**
   * Проверить доступность аудиокниги
   */
  async checkAudioBookAvailability(bookId: number): Promise<boolean> {
    try {
      const details = await this.getAudioBookDetails(bookId);
      return details !== null && (details.chapters?.length || 0) > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Получить список всех серий пользователя
   */
  async getUserSeries(): Promise<SeriesInfo[]> {
    try {
      Logger.verbose('Получаем список серий пользователя...');
      
      const headers = this.getHeaders(true);
      Logger.http('GET', '/v1/account/user-library');
      
      const response = await this.rateLimiter.executeWithRetry(async () => {
        return await this.api.get<UserLibraryInfo>('/v1/account/user-library', {
          headers,
          params: {
            page: 1,
            pageSize: 1000 // Получаем все книги для анализа серий
          }
        });
      });

      Logger.apiResponse(response.status, '/v1/account/user-library');
      const allBooks: WorkMetaInfo[] = response.data.worksInLibrary || [];
      Logger.verbose(`Всего книг в библиотеке: ${allBooks.length}`);
      
      // Подсчитываем аудиокниги
      const audioBooks = allBooks.filter(book => book.format === 2 || book.format === 'Audiobook');
      Logger.verbose(`Аудиокниг в библиотеке: ${audioBooks.length}`);
      
      const seriesMap = new Map<number, SeriesInfo>();
      let booksWithSeries = 0;

      // Группируем только аудиокниги по сериям
      allBooks.forEach((book: WorkMetaInfo) => {
        // Фильтруем только аудиокниги (format === 2)
        const isAudioBook = book.format === 2 || book.format === 'Audiobook';
        
        if (isAudioBook && book.seriesId && book.seriesTitle) {
          booksWithSeries++;
          Logger.debug(`Аудиокнига с серией: "${book.title}" -> Серия: "${book.seriesTitle}" (ID: ${book.seriesId})`);
          
          if (!seriesMap.has(book.seriesId)) {
            seriesMap.set(book.seriesId, {
              id: book.seriesId,
              title: book.seriesTitle,
              worksCount: 0,
              completedWorksCount: 0
            });
          }

          const series = seriesMap.get(book.seriesId)!;
          series.worksCount++;
          
          if (book.isFinished) {
            series.completedWorksCount++;
          }

          // Определяем первую и последнюю книгу в серии
          if (!series.firstWorkId || (book.seriesOrder && book.seriesOrder < series.firstWorkId)) {
            series.firstWorkId = book.id;
          }
          if (!series.lastWorkId || (book.seriesOrder && book.seriesOrder > series.lastWorkId)) {
            series.lastWorkId = book.id;
          }
        }
      });

      Logger.verbose(`Аудиокниг с сериями: ${booksWithSeries}`);
      Logger.verbose(`Найдено серий: ${seriesMap.size}`);

      const series = Array.from(seriesMap.values());
      series.forEach(s => {
        Logger.debug(`  - "${s.title}" (${s.worksCount} книг)`);
      });

      return series;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { status?: number; data?: { message?: string; code?: string } } };
      
      // Обрабатываем rate limiting ошибки
      if (axiosError.response?.status === 429 || axiosError.response?.data?.code === 'TooManyRequests') {
        RateLimiter.handleRateLimitError(axiosError);
      } else {
        Logger.error('Ошибка получения серий:', axiosError.response?.data?.message || errorMessage);
      }
      
      return [];
    }
  }

  /**
   * Получить книги из конкретной серии
   */
  async getSeriesBooks(seriesId: number): Promise<AudioBook[]> {
    try {
      Logger.verbose(`Получаем книги серии ID: ${seriesId}`);
      
      const headers = this.getHeaders(true);
      const response = await this.rateLimiter.executeWithRetry(async () => {
        return await this.api.get<UserLibraryInfo>('/v1/account/user-library', {
          headers,
          params: {
            page: 1,
            pageSize: 1000
          }
        });
      });

      const allBooks: WorkMetaInfo[] = response.data.worksInLibrary || [];
      const seriesBooks: AudioBook[] = allBooks
        .filter((book: WorkMetaInfo) => 
          book.seriesId === seriesId && 
          (book.format === 2 || book.format === 'Audiobook')
        )
        .map((book: WorkMetaInfo): AudioBook => ({
          id: book.id,
          title: book.title,
          authorFIO: book.authorFIO || '',
          coverUrl: book.coverUrl,
          reciter: book.reciter,
          format: book.format,
          isFinished: book.isFinished,
          textLength: book.textLength,
          price: book.price,
          discount: book.discount,
          isPurchased: book.isPurchased,
          lastReadTime: book.lastReadTime,
          addedToLibraryTime: book.addedToLibraryTime,
          seriesTitle: book.seriesTitle,
          seriesOrder: book.seriesOrder
        }))
        .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0)); // Сортируем по порядку в серии

      return seriesBooks;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { status?: number; data?: { message?: string; code?: string } } };
      
      // Обрабатываем rate limiting ошибки
      if (axiosError.response?.status === 429 || axiosError.response?.data?.code === 'TooManyRequests') {
        RateLimiter.handleRateLimitError(axiosError);
      } else {
        Logger.error('Ошибка получения книг серии:', axiosError.response?.data?.message || errorMessage);
      }
      
      return [];
    }
  }

  /**
   * Найти серию по названию
   */
  async findSeriesByTitle(seriesTitle: string): Promise<SeriesInfo | null> {
    try {
      const series = await this.getUserSeries();
      const foundSeries = series.find(s => 
        s.title.toLowerCase().includes(seriesTitle.toLowerCase())
      );
      return foundSeries || null;
    } catch (error) {
      console.error('Ошибка поиска серии:', error);
      return null;
    }
  }

  /**
   * Получить полную информацию о серии
   */
  async getSeriesDetails(seriesId: number): Promise<Series | null> {
    try {
      Logger.verbose(`Получаем детали серии ID: ${seriesId}`);
      
      const seriesInfo = await this.getUserSeries();
      const series = seriesInfo.find(s => s.id === seriesId);
      
      if (!series) {
        Logger.warn(`Серия с ID ${seriesId} не найдена`);
        return null;
      }

      Logger.verbose(`Найдена серия: ${series.title}`);
      const books = await this.getSeriesBooks(seriesId);
      
      return {
        id: series.id,
        title: series.title,
        description: series.description,
        works: books,
        totalWorks: series.worksCount,
        completedWorks: series.completedWorksCount
      };
    } catch (error) {
      Logger.error('Ошибка получения деталей серии:', error);
      return null;
    }
  }

  /**
   * Выйти из системы
   */
  async logout(): Promise<void> {
    this.clearTokens();
    console.log('Вы вышли из системы');
  }
}
