// Интерфейс для данных из библиотеки пользователя
export interface WorkMetaInfo {
  id: number;
  title: string;
  coverUrl?: string;
  lastModificationTime?: string;
  lastUpdateTime?: string;
  finishTime?: string;
  isFinished?: boolean;
  textLength?: number;
  textLengthLastRead?: number;
  price?: number;
  discount?: number;
  workForm?: number;
  status?: number;
  authorId?: number;
  authorFIO?: string;
  authorUserName?: string;
  originalAuthor?: string;
  translator?: string;
  reciter?: string;
  coAuthorId?: number;
  coAuthorFIO?: string;
  coAuthorUserName?: string;
  coAuthorConfirmed?: boolean;
  secondCoAuthorId?: number;
  secondCoAuthorFIO?: string;
  secondCoAuthorUserName?: string;
  secondCoAuthorConfirmed?: boolean;
  isPurchased?: boolean;
  userLikeId?: number;
  lastReadTime?: string;
  lastChapterId?: number;
  lastChapterProgress?: number;
  likeCount?: number;
  commentCount?: number;
  rewardCount?: number;
  rewardsEnabled?: boolean;
  inLibraryState?: number;
  addedToLibraryTime?: string;
  updateInLibraryTime?: string;
  privacyDisplay?: number;
  state?: number;
  isDraft?: boolean;
  enableRedLine?: boolean;
  enableTTS?: boolean;
  adultOnly?: boolean;
  seriesId?: number;
  seriesOrder?: number;
  seriesTitle?: string;
  seriesPurchaseDiscount?: number;
  afterword?: string;
  seriesNextWorkId?: number;
  genreId?: number;
  firstSubGenreId?: number;
  secondSubGenreId?: number;
  format: number | string; // 2 или 'Audiobook' = аудиокнига
  marks?: number[];
  purchaseTime?: string;
  likeTime?: string;
  markTime?: string;
  isPwp?: boolean;
}

export interface UserLibraryInfo {
  worksInLibrary: WorkMetaInfo[];
  readingCount: number;
  savedCount: number;
  finishedCount: number;
  purchasedCount: number;
  totalCount: number;
}

export interface AudioBook {
  id: number;
  title: string;
  authorFIO: string;
  annotation?: string;
  coverUrl?: string;
  duration?: number;
  chapters?: AudioChapter[];
  genre?: string;
  year?: number;
  // Дополнительные поля из библиотеки пользователя
  reciter?: string; // Чтец
  format: number | string; // Формат (2 или 'Audiobook' = аудиокнига)
  isFinished?: boolean; // Завершена ли книга
  textLength?: number; // Размер текста
  price?: number; // Цена
  discount?: number; // Скидка
  isPurchased?: boolean; // Куплена ли книга
  lastReadTime?: string; // Время последнего чтения
  addedToLibraryTime?: string; // Время добавления в библиотеку
  seriesTitle?: string; // Название серии
  seriesOrder?: number; // Порядок в серии
}

export interface AudioChapter {
  id: number;
  title: string;
  duration: number;
  order: number;
  audioUrl?: string;
  fileSize?: number;
}

export interface DownloadProgress {
  chapterId: number;
  chapterTitle: string;
  downloaded: number;
  total: number;
  percentage: number;
}

export interface DownloadOptions {
  outputDir: string;
  quality: 'high' | 'medium' | 'low';
  skipExisting: boolean;
  concurrentDownloads: number;
  maxRetries?: number; // Максимальное количество попыток при ошибке
  organizeBySeries?: boolean; // Организация по сериям
  seriesFolderTemplate?: string; // Шаблон папки серии
  workFolderTemplate?: string; // Шаблон папки книги
  standaloneFolder?: string; // Папка для книг без серии
  maxFolderNameLength?: number; // Максимальная длина имени папки
  sanitizeNames?: boolean; // Очистка имен файлов
}

// Типы ошибок API
export interface ApiError {
  code: string;
  message: string;
  invalidFields?: Record<string, string[]>;
  rateLimit?: number;
  period?: string;
  retryAfter?: number;
}

export interface ApiErrorResponse {
  code: 'ExpiredToken' | 'InvalidToken' | 'InvalidAuthorizationScheme' | 'AuthorizationRequired' | 'UserIsBanned' | 'UserEmailNotConfirmed' | 'UserAccountIsDisabled' | 'TooManyRequests' | 'InternalServerError' | 'InvalidRequestFields';
  message: string;
  invalidFields?: Record<string, string[]>;
  rateLimit?: number;
  period?: string;
  retryAfter?: number;
}

// Типы для работы с сериями
export interface Series {
  id: number;
  title: string;
  description?: string;
  works: AudioBook[];
  totalWorks: number;
  completedWorks: number;
}

export interface SeriesInfo {
  id: number;
  title: string;
  description?: string;
  worksCount: number;
  completedWorksCount: number;
  firstWorkId?: number;
  lastWorkId?: number;
}

export interface OrganizationConfig {
  bySeries: boolean;
  seriesFolderTemplate: string;
  workFolderTemplate: string;
  standaloneFolder: string;
  maxFolderNameLength: number;
  sanitizeNames: boolean;
}
