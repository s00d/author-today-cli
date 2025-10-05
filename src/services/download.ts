import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import chalk from 'chalk';
import { AudioBook, AudioChapter, DownloadOptions, DownloadProgress } from '../types';

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
    const bookDir = path.join(options.outputDir, this.sanitizeFileName(book.title));
    
    // Создаем папку для книги
    await fs.ensureDir(bookDir);

    // Очищаем временные файлы при повторном скачивании
    await this.cleanupTempFiles(bookDir);

    // Создаем файл с информацией о книге
    await this.saveBookInfo(book, bookDir);

    // Скачиваем обложку если есть и не существует
    if (book.coverUrl && !await this.coverExists(bookDir)) {
      await this.downloadCover(book.coverUrl, bookDir);
    }

    // Скачиваем дополнительные файлы
    await this.downloadAdditionalFiles(book, bookDir);

    // Получаем главы если их нет
    let chapters = book.chapters || [];
    if (chapters.length === 0) {
      chapters = await this.api.getAudioChapters(book.id);
    }

    console.log(chalk.blue(`Начинаем скачивание: ${book.title}`));
    console.log(chalk.gray(`Автор: ${book.authorFIO}`));
    console.log(chalk.gray(`Глав: ${chapters.length}`));
    console.log(chalk.gray(`Папка: ${bookDir}`));
    console.log('');

    // Скачиваем главы параллельно
    await this.downloadChaptersParallel(book.id, chapters, bookDir, options, onProgress);

    console.log(chalk.green(`\n✓ Аудиокнига "${book.title}" успешно скачана!`));
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
        console.log(chalk.yellow(`Пропускаем: ${chapter.title} (уже существует)`));
        continue;
      }

      chaptersToDownload.push({
        chapter,
        index: i,
        path: chapterPath
      });
    }

    if (chaptersToDownload.length === 0) {
      console.log(chalk.green('Все главы уже скачаны!'));
      return;
    }

    console.log(chalk.blue(`Скачиваем ${chaptersToDownload.length} глав в ${concurrentDownloads} потоков...`));

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
          
          console.log(`\n${chalk.green(`✓ Скачано: ${chapter.title} (${completedChapters}/${totalChapters})`)}`);
          break; // Успешно скачано, выходим из цикла
          
        } catch (error) {
          attempts++;
          activeDownloads.delete(chapter.id.toString());
          
          if (attempts < maxAttempts) {
            console.log(`\n${chalk.yellow(`⚠️  Ошибка скачивания: ${chapter.title} (попытка ${attempts}/${maxAttempts})`)}`);
            console.log(chalk.yellow(`  ${error}`));
            console.log(chalk.blue(`🔄 Повторная попытка через 2 секунды...`));
            
            // Ждем перед повторной попыткой
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            completedChapters++;
            console.log(`\n${chalk.red(`✗ Окончательная ошибка скачивания: ${chapter.title} (${maxAttempts} попыток)`)}`);
            console.log(chalk.red(`  ${error}`));
          }
        }
      }
      
      semaphore.release();
    });

    await Promise.all(downloadPromises);
    console.log(`\n${chalk.green('✓ Все главы скачаны!')}`);
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
      console.log(chalk.blue('📸 Скачиваем обложку...'));
      
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
            console.log(chalk.green('✅ Обложка скачана'));
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
      console.log(chalk.yellow('⚠️  Не удалось скачать обложку'));
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
        console.log(chalk.green('📄 Аннотация сохранена'));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️  Не удалось сохранить дополнительные файлы'));
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
          console.log(chalk.yellow(`🗑️  Удален временный файл: ${file}`));
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
}
