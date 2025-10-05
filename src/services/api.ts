import axios, { AxiosInstance } from 'axios';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { AudioBook, AudioChapter, WorkMetaInfo, UserLibraryInfo, ApiErrorResponse } from '../types';

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

  constructor() {
    // Сохраняем токен в системной папке пользователя
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.config', 'author-today-cli');
    this.tokenFile = path.join(configDir, 'auth-token.json');
    
    // Создаем папку конфигурации если её нет
    fs.ensureDirSync(configDir);
    
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'User-Agent': 'AuthorToday-CLI/1.0.0',
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
      'User-Agent': 'AuthorToday-CLI/1.0.0'
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
      // Для авторизации используем заголовки с guest токеном
      const headers = this.getHeaders(true);
      
      // Убираем пустой код из данных, если он не указан
      const dataToSend = { ...loginData };
      if (!dataToSend.code || dataToSend.code.trim() === '') {
        delete dataToSend.code;
      }
      
      const response = await this.api.post('/v1/account/login-by-password', dataToSend, {
        headers
      });
      
      // Сохраняем токен только если он есть (успешная авторизация)
      if (response.data && response.data.token) {
        this.accessToken = response.data.token;
        this.refreshToken = response.data.token;
        this.setAuthHeader();
        await this.saveToken(response.data);
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
        console.error('Ошибки валидации:');
        Object.entries(apiError.invalidFields).forEach(([field, messages]) => {
          console.error(`${field}: ${messages.join(', ')}`);
        });
      } else {
        console.error('Ошибка авторизации:', apiError?.message || errorMessage);
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
      const response = await this.api.get<Record<string, unknown>>('/v1/account/current-user', { headers });
      return {
        data: response.data,
        status: response.status
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { data?: { message?: string } } };
      console.error('Ошибка получения информации о пользователе:', axiosError.response?.data?.message || errorMessage);
      throw error;
    }
  }

  /**
   * Получить список аудиокниг из библиотеки пользователя
   */
  async getAudioBooks(page = 1, pageSize = 500): Promise<AudioBook[]> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.api.get<UserLibraryInfo>('/v1/account/user-library', {
        headers,
        params: {
          page,
          pageSize
        }
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
      const axiosError = error as { response?: { data?: { message?: string } } };
      console.error('Ошибка получения списка аудиокниг:', axiosError.response?.data?.message || errorMessage);
      throw error;
    }
  }

  /**
   * Поиск аудиокниг по запросу в библиотеке пользователя
   */
  async searchAudioBooks(query: string, page = 1, pageSize = 500): Promise<AudioBook[]> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.api.get<UserLibraryInfo>('/v1/account/user-library', {
        headers,
        params: {
          page,
          pageSize
        }
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
      const axiosError = error as { response?: { data?: { message?: string } } };
      console.error('Ошибка поиска аудиокниг:', axiosError.response?.data?.message || errorMessage);
      throw error;
    }
  }

  /**
   * Получить детали аудиокниги
   */
  async getAudioBookDetails(bookId: number): Promise<AudioBook | null> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.api.get<AudioBook>(`/v1/work/${bookId}/details`, { headers });
      return response.data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { data?: { message?: string } } };
      console.error('Ошибка получения деталей аудиокниги:', axiosError.response?.data?.message || errorMessage);
      return null;
    }
  }

  /**
   * Получить главы аудиокниги
   */
  async getAudioChapters(bookId: number): Promise<AudioChapter[]> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.api.get<AudioChapter[]>(`/v1/audiobook/${bookId}/content`, { headers });
      return response.data || [];
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { data?: { message?: string } } };
      console.error('Ошибка получения глав аудиокниги:', axiosError.response?.data?.message || errorMessage);
      return [];
    }
  }

  /**
   * Получить URL для скачивания аудиофайла главы
   */
  async getChapterAudioUrl(bookId: number, chapterId: number): Promise<string | null> {
    try {
      const headers = this.getHeaders(true);
      const response = await this.api.get<{ url: string }>(`/v1/audiobook/get-url/${bookId}/${chapterId}`, { headers });
      return response.data.url || null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const axiosError = error as { response?: { data?: { message?: string } } };
      console.error('Ошибка получения URL аудио:', axiosError.response?.data?.message || errorMessage);
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
   * Выйти из системы
   */
  async logout(): Promise<void> {
    this.clearTokens();
    console.log('Вы вышли из системы');
  }
}
