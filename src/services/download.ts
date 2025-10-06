import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import chalk from 'chalk';
import { AudioBook, AudioChapter, DownloadOptions, DownloadProgress, OrganizationConfig } from '../types';
import { Logger } from '../utils/logger';

/**
 * Простой семафор для ограничения количества одновременных операций
 */
class Semaphore {
  private permits: number;
  private waitingQueue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitingQueue.length > 0) {
      const resolve = this.waitingQueue.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }
}

export class DownloadManager {
  private api: any;
  private defaultConfig: OrganizationConfig = {
    bySeries: true,
    seriesFolderTemplate: '{series}',
    workFolderTemplate: '{order:03d}. {title}',
    standaloneFolder: 'Отдельные книги',
    maxFolderNameLength: 100,
    sanitizeNames: true
  };

  constructor(api: any) {
    this.api = api;
  }

  /**
   * Скачать аудиокнигу
   */
  async downloadAudioBook(
    book: AudioBook, 
    options: DownloadOptions,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    // Определяем путь для книги с учетом организации по сериям
    const bookDir = this.getBookDirectory(book, options);
    Logger.verbose(`Путь для книги: ${bookDir}`);
    
    // Создаем папку для книги
    Logger.mkdir(bookDir);
    await fs.ensureDir(bookDir);

    // Очищаем временные файлы при повторном скачивании
    await this.cleanupTempFiles(bookDir);

    // Создаем файл с информацией о книге
    Logger.file('Создаем', 'book-info.json', bookDir);
    await this.saveBookInfo(book, bookDir);

    // Скачиваем обложку если есть и не существует
    if (book.coverUrl && !await this.coverExists(bookDir)) {
      Logger.download('Скачиваем обложку', book.coverUrl);
      await this.downloadCover(book.coverUrl, bookDir);
    }

    // Скачиваем дополнительные файлы
    await this.downloadAdditionalFiles(book, bookDir);

    // Получаем главы если их нет
    let chapters = book.chapters || [];
    if (chapters.length === 0) {
      Logger.verbose('Получаем список глав...');
      chapters = await this.api.getAudioChapters(book.id);
    }

    Logger.info(`Начинаем скачивание: ${book.title}`);
    Logger.verbose(`Автор: ${book.authorFIO}`);
    Logger.verbose(`Глав: ${chapters.length}`);
    Logger.verbose(`Папка: ${bookDir}`);

    // Скачиваем главы параллельно
    await this.downloadChaptersParallel(book.id, chapters, bookDir, options, onProgress);

    Logger.success(`Аудиокнига "${book.title}" успешно скачана!`);
  }

  /**
   * Скачать главы параллельно
   */
  private async downloadChaptersParallel(
    bookId: number,
    chapters: AudioChapter[],
    bookDir: string,
    options: DownloadOptions,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    const concurrentDownloads = options.concurrentDownloads || 3;
    const chaptersToDownload: { chapter: AudioChapter; index: number; path: string }[] = [];

    // Подготавливаем список глав для скачивания
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      const chapterPath = path.join(bookDir, `${String(i + 1).padStart(3, '0')}. ${this.sanitizeFileName(chapter.title)}.mp3`);
      
      // Проверяем, существует ли файл
      if (options.skipExisting && await fs.pathExists(chapterPath)) {
        Logger.verbose(`Пропускаем: ${chapter.title} (уже существует)`);
        continue;
      }

      chaptersToDownload.push({
        chapter,
        index: i,
        path: chapterPath
      });
    }

    if (chaptersToDownload.length === 0) {
      Logger.success('Все главы уже скачаны!');
      return;
    }

    Logger.info(`Скачиваем ${chaptersToDownload.length} глав в ${concurrentDownloads} потоков...`);

    // Создаем семафор для ограничения количества одновременных загрузок
    const semaphore = new Semaphore(concurrentDownloads);
    
    // Общий прогресс для всех загрузок
    let completedChapters = 0;
    const totalChapters = chaptersToDownload.length;
    const activeDownloads = new Map<string, { chapter: AudioChapter; progress: number }>();
    
    // Скачиваем главы параллельно с повторными попытками
    const downloadPromises = chaptersToDownload.map(async ({ chapter, index, path }) => {
      await semaphore.acquire();
      
      let attempts = 0;
      const maxAttempts = options.maxRetries || 3;
      
      while (attempts < maxAttempts) {
        try {
          await this.downloadChapter(bookId, chapter, path, (progress) => {
            // Обновляем прогресс конкретной главы
            activeDownloads.set(chapter.id.toString(), { chapter, progress: progress.percentage });
            
            // Формируем строку прогресса для всех активных загрузок
            const activeProgresses = Array.from(activeDownloads.values())
              .map(({ chapter: ch, progress: p }) => `${ch.title}: ${p}%`)
              .join(' ');
            
            const overallProgress = Math.round((completedChapters / totalChapters) * 100);
            process.stdout.write(`\r${chalk.blue('Общий прогресс')}: ${overallProgress}% (${completedChapters}/${totalChapters}) - ${activeProgresses}`);
          });
          
          // Удаляем завершенную загрузку из активных
          activeDownloads.delete(chapter.id.toString());
          completedChapters++;
          
          Logger.success(`Скачано: ${chapter.title} (${completedChapters}/${totalChapters})`);
          break; // Успешно скачано, выходим из цикла
          
        } catch (error) {
          attempts++;
          activeDownloads.delete(chapter.id.toString());
          
          if (attempts < maxAttempts) {
            Logger.warn(`Ошибка скачивания: ${chapter.title} (попытка ${attempts}/${maxAttempts})`);
            Logger.verbose(`  ${error}`);
            Logger.verbose('Повторная попытка через 2 секунды...');
            
            // Ждем перед повторной попыткой
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            completedChapters++;
            Logger.error(`Окончательная ошибка скачивания: ${chapter.title} (${maxAttempts} попыток)`);
            Logger.error(`  ${error}`);
          }
        }
      }
      
      semaphore.release();
    });

    await Promise.all(downloadPromises);
    Logger.success('Все главы скачаны!');
  }

  /**
   * Скачать отдельную главу
   */
  private async downloadChapter(
    bookId: number,
    chapter: AudioChapter,
    outputPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    // Получаем URL для скачивания
    const audioUrl = await this.api.getChapterAudioUrl(bookId, chapter.id);
    if (!audioUrl) {
      throw new Error('Не удалось получить URL для скачивания');
    }

    // Создаем временный файл
    const tempPath = `${outputPath}.tmp`;
    
    // Скачиваем файл
    const response = await axios({
      method: 'GET',
      url: audioUrl,
      responseType: 'stream',
    });

    const totalSize = parseInt(response.headers['content-length'] || '0');
    let downloadedSize = 0;

    const writer = fs.createWriteStream(tempPath);
    
    response.data.on('data', (chunk: Buffer) => {
      downloadedSize += chunk.length;
      
      if (onProgress) {
        onProgress({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          downloaded: downloadedSize,
          total: totalSize,
          percentage: totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0
        });
      }
    });

    return new Promise((resolve, reject) => {
      response.data.pipe(writer);
      
      writer.on('finish', async () => {
        try {
          // Переименовываем временный файл в финальный
          await fs.move(tempPath, outputPath);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      
      writer.on('error', (error) => {
        // Удаляем временный файл при ошибке
        fs.unlink(tempPath).catch(() => {});
        reject(error);
      });
      response.data.on('error', reject);
    });
  }

  /**
   * Сохранить информацию о книге в файл
   */
  private async saveBookInfo(book: AudioBook, bookDir: string): Promise<void> {
    const info = {
      title: book.title,
      author: book.authorFIO,
      annotation: book.annotation,
      genre: book.genre,
      year: book.year,
      downloadedAt: new Date().toISOString(),
      chapters: book.chapters?.map(ch => ({
        id: ch.id,
        title: ch.title,
        duration: ch.duration,
        order: ch.order
      }))
    };

    await fs.writeJSON(path.join(bookDir, 'book-info.json'), info, { spaces: 2 });
  }

  /**
   * Очистить имя файла от недопустимых символов
   */
  private sanitizeFileName(fileName: string): string {
    return fileName
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Проверить существующие скачанные книги
   */
  async getDownloadedBooks(outputDir: string): Promise<string[]> {
    try {
      const dirs = await fs.readdir(outputDir);
      const downloadedBooks: string[] = [];

      for (const dir of dirs) {
        const bookPath = path.join(outputDir, dir);
        const stat = await fs.stat(bookPath);
        
        if (stat.isDirectory()) {
          const infoPath = path.join(bookPath, 'book-info.json');
          if (await fs.pathExists(infoPath)) {
            downloadedBooks.push(dir);
          }
        }
      }

      return downloadedBooks;
    } catch (error) {
      return [];
    }
  }

  /**
   * Получить информацию о скачанной книге
   */
  async getDownloadedBookInfo(outputDir: string, bookName: string): Promise<any> {
    try {
      const infoPath = path.join(outputDir, bookName, 'book-info.json');
      return await fs.readJSON(infoPath);
    } catch (error) {
      return null;
    }
  }

  /**
   * Скачать обложку книги
   */
  private async downloadCover(coverUrl: string, bookDir: string): Promise<void> {
    try {
      Logger.verbose('Скачиваем обложку...');
      
      const response = await axios.get(coverUrl, {
        responseType: 'stream',
        timeout: 30000
      });

      // Определяем расширение файла из URL или Content-Type
      let extension = '.jpg';
      if (coverUrl.includes('.png')) {
        extension = '.png';
      } else if (coverUrl.includes('.webp')) {
        extension = '.webp';
      } else if (response.headers['content-type']?.includes('png')) {
        extension = '.png';
      } else if (response.headers['content-type']?.includes('webp')) {
        extension = '.webp';
      }

      const coverPath = path.join(bookDir, `cover${extension}`);
      const tempCoverPath = `${coverPath}.tmp`;
      const writer = fs.createWriteStream(tempCoverPath);
      
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', async () => {
          try {
            // Переименовываем временный файл в финальный
            await fs.move(tempCoverPath, coverPath);
            Logger.success('Обложка скачана');
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        writer.on('error', (error) => {
          // Удаляем временный файл при ошибке
          fs.unlink(tempCoverPath).catch(() => {});
          reject(error);
        });
      });
    } catch (error) {
      Logger.warn('Не удалось скачать обложку');
      Logger.verbose(`Ошибка: ${error}`);
    }
  }

  /**
   * Скачать дополнительные файлы (если есть)
   */
  private async downloadAdditionalFiles(book: AudioBook, bookDir: string): Promise<void> {
    try {
      // Здесь можно добавить скачивание дополнительных файлов
      // Например, аннотации, превью и т.д.
      
      if (book.annotation) {
        const annotationPath = path.join(bookDir, 'annotation.txt');
        await fs.writeFile(annotationPath, book.annotation, 'utf8');
        Logger.verbose('Аннотация сохранена');
      }
    } catch (error) {
      Logger.warn('Не удалось сохранить дополнительные файлы');
      Logger.verbose(`Ошибка: ${error}`);
    }
  }

  /**
   * Очистить временные файлы
   */
  private async cleanupTempFiles(bookDir: string): Promise<void> {
    try {
      const files = await fs.readdir(bookDir);
      for (const file of files) {
        if (file.endsWith('.tmp')) {
          const tempPath = path.join(bookDir, file);
          await fs.unlink(tempPath);
          Logger.cleanup(`Удален временный файл: ${file}`);
        }
      }
    } catch (error) {
      // Игнорируем ошибки при очистке
    }
  }

  /**
   * Проверить существование обложки
   */
  private async coverExists(bookDir: string): Promise<boolean> {
    const extensions = ['.jpg', '.png', '.webp'];
    for (const ext of extensions) {
      const coverPath = path.join(bookDir, `cover${ext}`);
      if (await fs.pathExists(coverPath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Получить путь для книги с учетом организации по сериям
   */
  private getBookDirectory(book: AudioBook, options: DownloadOptions): string {
    const config = this.mergeConfig(options);
    
    if (!config.bySeries || !book.seriesTitle) {
      // Книга без серии - помещаем в папку для отдельных книг
      const standaloneDir = path.join(options.outputDir, config.standaloneFolder);
      const bookName = this.formatFolderName(book.title, config);
      return path.join(standaloneDir, bookName);
    }

    // Книга из серии - создаем структуру папок
    const seriesName = this.formatFolderName(book.seriesTitle, config);
    const seriesDir = path.join(options.outputDir, seriesName);
    
    // Формируем имя папки книги по шаблону
    const bookName = this.formatWorkFolderName(book, config);
    return path.join(seriesDir, bookName);
  }

  /**
   * Объединить конфигурацию с настройками по умолчанию
   */
  private mergeConfig(options: DownloadOptions): OrganizationConfig {
    return {
      bySeries: options.organizeBySeries ?? this.defaultConfig.bySeries,
      seriesFolderTemplate: options.seriesFolderTemplate ?? this.defaultConfig.seriesFolderTemplate,
      workFolderTemplate: options.workFolderTemplate ?? this.defaultConfig.workFolderTemplate,
      standaloneFolder: options.standaloneFolder ?? this.defaultConfig.standaloneFolder,
      maxFolderNameLength: options.maxFolderNameLength ?? this.defaultConfig.maxFolderNameLength,
      sanitizeNames: options.sanitizeNames ?? this.defaultConfig.sanitizeNames
    };
  }

  /**
   * Форматировать имя папки
   */
  private formatFolderName(name: string, config: OrganizationConfig): string {
    let formattedName = name;
    
    if (config.sanitizeNames) {
      formattedName = this.sanitizeFileName(formattedName);
    }
    
    // Ограничиваем длину имени
    if (formattedName.length > config.maxFolderNameLength) {
      formattedName = formattedName.substring(0, config.maxFolderNameLength).trim();
    }
    
    return formattedName;
  }

  /**
   * Форматировать имя папки книги по шаблону
   */
  private formatWorkFolderName(book: AudioBook, config: OrganizationConfig): string {
    let folderName = config.workFolderTemplate;
    
    // Заменяем плейсхолдеры
    folderName = folderName.replace('{title}', book.title);
    folderName = folderName.replace('{order:03d}', String(book.seriesOrder || 0).padStart(3, '0'));
    folderName = folderName.replace('{order}', String(book.seriesOrder || 0));
    folderName = folderName.replace('{author}', book.authorFIO);
    folderName = folderName.replace('{series}', book.seriesTitle || '');
    
    return this.formatFolderName(folderName, config);
  }

  /**
   * Скачать всю серию
   */
  async downloadSeries(
    seriesId: number,
    options: DownloadOptions,
    onProgress?: (progress: { book: string; progress: DownloadProgress }) => void
  ): Promise<void> {
    try {
      const series = await this.api.getSeriesDetails(seriesId);
      if (!series) {
        throw new Error('Серия не найдена');
      }

      Logger.info(`Начинаем скачивание серии: ${series.title}`);
      Logger.verbose(`Книг в серии: ${series.works.length}`);

      for (let i = 0; i < series.works.length; i++) {
        const book = series.works[i];
        Logger.info(`Скачиваем книгу ${i + 1}/${series.works.length}: ${book.title}`);
        
        await this.downloadAudioBook(book, options, (progress) => {
          if (onProgress) {
            onProgress({
              book: book.title,
              progress
            });
          }
        });
        
        Logger.success(`Книга "${book.title}" скачана`);
      }

      Logger.success(`Серия "${series.title}" полностью скачана!`);
    } catch (error) {
      Logger.error(`Ошибка скачивания серии: ${error}`);
      throw error;
    }
  }

  /**
   * Получить список скачанных серий
   */
  async getDownloadedSeries(outputDir: string): Promise<string[]> {
    try {
      const dirs = await fs.readdir(outputDir);
      const series: string[] = [];

      for (const dir of dirs) {
        const seriesPath = path.join(outputDir, dir);
        const stat = await fs.stat(seriesPath);
        
        if (stat.isDirectory()) {
          // Проверяем, содержит ли папка книги (есть ли подпапки с book-info.json)
          const subDirs = await fs.readdir(seriesPath);
          const hasBooks = subDirs.some(subDir => {
            const bookPath = path.join(seriesPath, subDir);
            return fs.pathExists(path.join(bookPath, 'book-info.json'));
          });
          
          if (hasBooks) {
            series.push(dir);
          }
        }
      }

      return series;
    } catch (error) {
      return [];
    }
  }

  /**
   * Получить информацию о скачанной серии
   */
  async getDownloadedSeriesInfo(outputDir: string, seriesName: string): Promise<any> {
    try {
      const seriesPath = path.join(outputDir, seriesName);
      const subDirs = await fs.readdir(seriesPath);
      const books: any[] = [];

      for (const subDir of subDirs) {
        const bookPath = path.join(seriesPath, subDir);
        const stat = await fs.stat(bookPath);
        
        if (stat.isDirectory()) {
          const bookInfo = await this.getDownloadedBookInfo(seriesPath, subDir);
          if (bookInfo) {
            books.push(bookInfo);
          }
        }
      }

      return {
        name: seriesName,
        books: books.sort((a, b) => a.title.localeCompare(b.title)),
        totalBooks: books.length
      };
    } catch (error) {
      return null;
    }
  }
}
