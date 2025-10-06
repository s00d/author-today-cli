#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import { AuthorTodayAPI, LoginData } from './services/api';
import { DownloadManager } from './services/download';
import { AudioBook, DownloadOptions } from './types';
import { search } from '@inquirer/prompts';
import { Logger, setVerboseMode } from './utils/logger';
// Импортируем версию из package.json
import packageJson from '../package.json'; 

const program = new Command();
const api = new AuthorTodayAPI(packageJson.version);
const downloadManager = new DownloadManager(api);

// Глобальная переменная для verbose режима
let verboseMode = false;

program
  .name('author-today-cli')
  .description('CLI для загрузки аудиокниг с Author Today')
  .version(packageJson.version)
  .option('-v, --verbose', 'Подробный вывод (показывать все логи)')
  .hook('preAction', (thisCommand) => {
    verboseMode = thisCommand.opts().verbose || false;
    setVerboseMode(verboseMode);
  });

// Команда для авторизации
program
  .command('login')
  .description('Авторизация в системе')
  .action(async () => {
    try {
      await loginUser();
    } catch (error) {
      console.error(chalk.red('Ошибка авторизации:', error));
      process.exit(1);
    }
  });

// Команда для выхода из системы
program
  .command('logout')
  .description('Выйти из системы')
  .action(async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

// Команда для проверки статуса авторизации
program
  .command('status')
  .description('Показать статус авторизации')
  .action(async () => {
    try {
      await showAuthStatus();
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

// Команда для поиска и скачивания аудиокниг
program
  .command('search')
  .description('Поиск и скачивание аудиокниг')
  .option('-q, --query <query>', 'Поисковый запрос')
  .option('-o, --output <dir>', 'Папка для скачивания', './audiobooks')
  .option('-c, --concurrent <number>', 'Количество одновременных загрузок', '3')
  .option('-r, --retries <number>', 'Количество попыток при ошибке', '3')
  .option('--organize-by-series', 'Организовать по сериям (по умолчанию)')
  .option('--no-series-organization', 'Отключить организацию по сериям')
  .option('--series-folder-template <template>', 'Шаблон папки серии', '{series}')
  .option('--work-folder-template <template>', 'Шаблон папки книги', '{order:03d}. {title}')
  .option('--standalone-folder <name>', 'Папка для книг без серии', 'Отдельные книги')
  .action(async (options) => {
    try {
      await searchAndDownload(options);
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

// Команда для просмотра скачанных книг
program
  .command('list-downloaded')
  .description('Показать скачанные аудиокниги')
  .option('-o, --output <dir>', 'Папка с загрузками', './audiobooks')
  .action(async (options) => {
    try {
      await listDownloadedBooks(options.output);
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

// Команда для скачивания конкретной книги
program
  .command('download <bookId>')
  .description('Скачать аудиокнигу по ID')
  .option('-o, --output <dir>', 'Папка для скачивания', './audiobooks')
  .option('-c, --concurrent <number>', 'Количество одновременных загрузок', '3')
  .option('-r, --retries <number>', 'Количество попыток при ошибке', '3')
  .option('--organize-by-series', 'Организовать по сериям (по умолчанию)')
  .option('--no-series-organization', 'Отключить организацию по сериям')
  .option('--series-folder-template <template>', 'Шаблон папки серии', '{series}')
  .option('--work-folder-template <template>', 'Шаблон папки книги', '{order:03d}. {title}')
  .option('--standalone-folder <name>', 'Папка для книг без серии', 'Отдельные книги')
  .action(async (bookId, options) => {
    try {
      await downloadBookById(parseInt(bookId), options);
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

// Команда для скачивания серии
program
  .command('download-series <seriesName>')
  .description('Скачать всю серию по названию')
  .option('-o, --output <dir>', 'Папка для скачивания', './audiobooks')
  .option('-c, --concurrent <number>', 'Количество одновременных загрузок', '3')
  .option('-r, --retries <number>', 'Количество попыток при ошибке', '3')
  .option('--m4b', 'Конвертировать в M4B формат после скачивания')
  .option('--series-folder-template <template>', 'Шаблон папки серии', '{series}')
  .option('--work-folder-template <template>', 'Шаблон папки книги', '{order:03d}. {title}')
  .action(async (seriesName, options) => {
    try {
      await downloadSeriesByName(seriesName, options);
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

// Команда для просмотра серий
program
  .command('list-series')
  .description('Показать все серии пользователя')
  .action(async () => {
    try {
      await listUserSeries();
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

// Команда для просмотра скачанных серий
program
  .command('list-downloaded-series')
  .description('Показать скачанные серии')
  .option('-o, --output <dir>', 'Папка с загрузками', './audiobooks')
  .action(async (options) => {
    try {
      await listDownloadedSeries(options.output);
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

// Команда для показа информации о серии
program
  .command('show-series <seriesName>')
  .description('Показать информацию о серии')
  .action(async (seriesName) => {
    try {
      await showSeriesInfo(seriesName);
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

// Команда для отладки - показать все книги в библиотеке
program
  .command('debug-library')
  .description('Показать все книги в библиотеке (для отладки)')
  .action(async () => {
    try {
      await debugLibrary();
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

async function loginUser(): Promise<void> {
  Logger.info('Авторизация в Author Today');
  
  const { login, password } = await inquirer.prompt([
    {
      type: 'input',
      name: 'login',
      message: 'Логин или email:',
      validate: (input) => input.length > 0 || 'Введите логин'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Пароль:',
      mask: '*',
      validate: (input) => input.length > 0 || 'Введите пароль'
    }
  ]);

  try {
    Logger.verbose('Выполняется авторизация...');
    let loginData: LoginData = { login, password };
    let response = await api.login(loginData);
    
    // Проверяем, требуется ли 2FA
    if (response.data.twoFactorEnabled && !response.data.token) {
      Logger.warn('Требуется код двухфакторной аутентификации');
      
      const { code } = await inquirer.prompt([
        {
          type: 'input',
          name: 'code',
          message: 'Введите код из приложения:',
          validate: (input) => input.length > 0 || 'Введите код'
        }
      ]);
      
      // Повторная авторизация с кодом
      loginData.code = code;
      response = await api.login(loginData);
    }
    
    if (response.data.token) {
      Logger.success('Авторизация успешна!');
      
      // Получаем информацию о пользователе
      try {
        const userResponse = await api.getCurrentUser();
        if (userResponse.data && typeof userResponse.data === 'object') {
          const userData = userResponse.data as Record<string, unknown>;
          const nickname = userData.nickname as string;
          const userLogin = userData.login as string;
          const displayName = nickname || userLogin || login;
          Logger.success(`Добро пожаловать, ${displayName}!`);
        }
      } catch (error) {
        Logger.success(`Добро пожаловать, ${login}!`);
      }
    }
  } catch (error: unknown) {
    Logger.error('Ошибка авторизации:');
    const axiosError = error as { response?: { data?: { message?: string; code?: string; invalidFields?: Record<string, string[]> } } };
    const apiError = axiosError.response?.data;
    
    if (apiError?.code === 'InvalidRequestFields' && apiError.invalidFields) {
      Logger.error('Ошибки валидации:');
      Object.entries(apiError.invalidFields).forEach(([field, messages]) => {
        Logger.error(`${field}: ${messages.join(', ')}`);
      });
    } else if (apiError?.message) {
      Logger.error(apiError.message);
    } else {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      Logger.error(errorMessage);
    }
    throw error;
  }
}

async function showAuthStatus(): Promise<void> {
  if (api.isAuthenticated()) {
    Logger.success('Вы авторизованы');
    try {
      const userResponse = await api.getCurrentUser();
      if (userResponse.data && typeof userResponse.data === 'object') {
        const userData = userResponse.data as Record<string, unknown>;
        const nickname = userData.nickname as string;
        const login = userData.login as string;
        const displayName = nickname || login || 'Пользователь';
        Logger.info(`Пользователь: ${displayName}`);
      } else {
        Logger.info('Пользователь: Авторизован');
      }
    } catch (error) {
      Logger.info('Пользователь: Авторизован');
    }
  } else {
    Logger.error('Вы не авторизованы');
    Logger.warn('Используйте команду "login" для авторизации');
  }
}

async function ensureAuthenticated(): Promise<void> {
  if (!api.isAuthenticated()) {
    Logger.warn('Требуется авторизация');
    await loginUser();
  }
}

async function searchAndDownload(options: { 
  output: string; 
  query?: string; 
  concurrent?: string; 
  retries?: string; 
  m4b?: boolean;
  organizeBySeries?: boolean;
  noSeriesOrganization?: boolean;
  seriesFolderTemplate?: string;
  workFolderTemplate?: string;
  standaloneFolder?: string;
}) {
  // Проверяем авторизацию
  await ensureAuthenticated();
  
  Logger.info('Поиск аудиокниг...');
  
  // Создаем папку для загрузок
  Logger.mkdir(options.output);
  await fs.ensureDir(options.output);

  let allBooks: AudioBook[] = [];
  let currentPage = 1;
  const pageSize = 50;
  let hasMorePages = true;

  // Загружаем все страницы
  while (hasMorePages) {
    Logger.verbose(`Загружаем страницу ${currentPage}...`);
    
    let pageBooks: AudioBook[] = [];
    
    if (options.query) {
      pageBooks = await api.searchAudioBooks(options.query, currentPage, pageSize);
    } else {
      pageBooks = await api.getAudioBooks(currentPage, pageSize);
    }

    if (pageBooks.length === 0) {
      hasMorePages = false;
    } else {
      allBooks = allBooks.concat(pageBooks);
      
      // Если получили меньше книг чем размер страницы, значит это последняя страница
      if (pageBooks.length < pageSize) {
        hasMorePages = false;
      } else {
        currentPage++;
      }
    }
  }

  if (allBooks.length === 0) {
    Logger.warn('Аудиокниги не найдены');
    return;
  }

  Logger.success(`Найдено аудиокниг: ${allBooks.length}`);

  const selectedBook = await search({
    message: 'Выберите аудиокнигу для скачивания:',
    source: async (input) => {
      if (!input) {
        return allBooks.map(book => {
          // Основная информация
          let name = `${chalk.cyan(book.title)} - ${chalk.yellow(book.authorFIO)}`;
          
          // Дополнительная информация разными цветами
          const details = [];
          if (book.reciter) {
            details.push(`${chalk.magenta(`Чтец: ${book.reciter}`)}`);
          }
          if (book.seriesTitle) {
            details.push(`${chalk.blue(`Серия: ${book.seriesTitle}`)}`);
          }
          if (book.isFinished) {
            details.push(`${chalk.green('✓ Завершена')}`);
          }
          
          if (details.length > 0) {
            name += ` (${details.join(', ')})`;
          }
          
          return {
            name,
            value: book
          };
        });
      }

      const filtered = allBooks.filter(book => 
        book.title.toLowerCase().includes(input.toLowerCase()) ||
        book.authorFIO.toLowerCase().includes(input.toLowerCase()) ||
        (book.reciter && book.reciter.toLowerCase().includes(input.toLowerCase())) ||
        (book.seriesTitle && book.seriesTitle.toLowerCase().includes(input.toLowerCase()))
      );
      
      return filtered.map(book => {
        // Основная информация
        let name = `${chalk.cyan(book.title)} - ${chalk.yellow(book.authorFIO)}`;
        
        // Дополнительная информация разными цветами
        const details = [];
        if (book.reciter) {
          details.push(`${chalk.magenta(`Чтец: ${book.reciter}`)}`);
        }
        if (book.seriesTitle) {
          details.push(`${chalk.blue(`Серия: ${book.seriesTitle}`)}`);
        }
        if (book.isFinished) {
          details.push(`${chalk.green('✓ Завершена')}`);
        }
        
        if (details.length > 0) {
          name += ` (${details.join(', ')})`;
        }
        
        return {
          name,
          value: book
        };
      });
    }
  });
  
  // Получаем детали книги
  Logger.verbose('Получаем детали книги...');
  const bookDetails = await api.getAudioBookDetails(selectedBook.id);
  
  if (!bookDetails) {
    Logger.error('Не удалось получить детали книги');
    return;
  }

  // Получаем главы
  const chapters = await api.getAudioChapters(selectedBook.id);
  bookDetails.chapters = chapters;

  // Настройки скачивания
  const downloadOptions: DownloadOptions = {
    outputDir: options.output,
    quality: 'high',
    skipExisting: true,
    concurrentDownloads: parseInt(options.concurrent || '3'),
    maxRetries: parseInt(options.retries || '3'),
    organizeBySeries: options.noSeriesOrganization ? false : (options.organizeBySeries ?? true),
    seriesFolderTemplate: options.seriesFolderTemplate,
    workFolderTemplate: options.workFolderTemplate,
    standaloneFolder: options.standaloneFolder
  };

  // Скачиваем книгу
  await downloadManager.downloadAudioBook(bookDetails, downloadOptions);
}

async function listDownloadedBooks(outputDir: string) {
  console.log(chalk.blue('📚 Скачанные аудиокниги:'));
  
  const downloadedBooks = await downloadManager.getDownloadedBooks(outputDir);
  
  if (downloadedBooks.length === 0) {
    console.log(chalk.yellow('Скачанные аудиокниги не найдены'));
    return;
  }

  for (const bookName of downloadedBooks) {
    const bookInfo = await downloadManager.getDownloadedBookInfo(outputDir, bookName);
    
    if (bookInfo) {
      console.log(chalk.green(`📖 ${bookInfo.title}`));
      console.log(chalk.gray(`   Автор: ${bookInfo.author}`));
      console.log(chalk.gray(`   Скачано: ${new Date(bookInfo.downloadedAt).toLocaleDateString()}`));
      console.log(chalk.gray(`   Глав: ${bookInfo.chapters?.length || 0}`));
      console.log('');
    }
  }
}

async function downloadBookById(bookId: number, options: { 
  output: string; 
  concurrent?: string; 
  retries?: string; 
  m4b?: boolean;
  organizeBySeries?: boolean;
  noSeriesOrganization?: boolean;
  seriesFolderTemplate?: string;
  workFolderTemplate?: string;
  standaloneFolder?: string;
}) {
  Logger.verbose(`Получаем информацию о книге ID: ${bookId}`);
  
  const bookDetails = await api.getAudioBookDetails(bookId);
  
  if (!bookDetails) {
    Logger.error('Книга не найдена или недоступна');
    return;
  }

  // Получаем главы
  const chapters = await api.getAudioChapters(bookId);
  bookDetails.chapters = chapters;

  // Настройки скачивания
  const downloadOptions: DownloadOptions = {
    outputDir: options.output,
    quality: 'high',
    skipExisting: true,
    concurrentDownloads: parseInt(options.concurrent || '3'),
    maxRetries: parseInt(options.retries || '3'),
    organizeBySeries: options.noSeriesOrganization ? false : (options.organizeBySeries ?? true),
    seriesFolderTemplate: options.seriesFolderTemplate,
    workFolderTemplate: options.workFolderTemplate,
    standaloneFolder: options.standaloneFolder
  };

  // Скачиваем книгу
  await downloadManager.downloadAudioBook(bookDetails, downloadOptions);
}

// Новые функции для работы с сериями
async function downloadSeriesByName(seriesName: string, options: {
  output: string;
  concurrent?: string;
  retries?: string;
  m4b?: boolean;
  seriesFolderTemplate?: string;
  workFolderTemplate?: string;
}) {
  await ensureAuthenticated();
  
  Logger.verbose(`Ищем серию: ${seriesName}`);
  
  // Получаем все серии и ищем подходящие
  const allSeries = await api.getUserSeries();
  if (allSeries.length === 0) {
    Logger.error('У вас нет серий аудиокниг в библиотеке');
    return;
  }
  
  // Фильтруем серии по названию
  const matchingSeries = allSeries.filter(s => 
    s.title.toLowerCase().includes(seriesName.toLowerCase())
  );
  
  if (matchingSeries.length === 0) {
    Logger.error(`Серия "${seriesName}" не найдена`);
    Logger.info('Доступные серии:');
    allSeries.forEach(s => {
      Logger.verbose(`   - ${s.title}`);
    });
    return;
  }
  
  let selectedSeries;
  if (matchingSeries.length === 1) {
    selectedSeries = matchingSeries[0];
    Logger.success(`Найдена серия: ${selectedSeries.title}`);
  } else {
    Logger.info(`Найдено ${matchingSeries.length} серий:`);
    const { seriesChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'seriesChoice',
        message: 'Выберите серию для скачивания:',
        choices: matchingSeries.map(s => ({
          name: `${s.title} (${s.worksCount} аудиокниг)`,
          value: s
        }))
      }
    ]);
    selectedSeries = seriesChoice;
  }
  
  Logger.verbose(`Аудиокниг в серии: ${selectedSeries.worksCount}`);
  
  // Настройки скачивания
  const downloadOptions: DownloadOptions = {
    outputDir: options.output,
    quality: 'high',
    skipExisting: true,
    concurrentDownloads: parseInt(options.concurrent || '3'),
    maxRetries: parseInt(options.retries || '3'),
    organizeBySeries: true,
    seriesFolderTemplate: options.seriesFolderTemplate,
    workFolderTemplate: options.workFolderTemplate
  };
  
  await downloadManager.downloadSeries(selectedSeries.id, downloadOptions);
}

async function listUserSeries() {
  await ensureAuthenticated();
  
  Logger.info('Ваши серии аудиокниг:');
  
  const series = await api.getUserSeries();
  if (series.length === 0) {
    Logger.warn('У вас нет серий аудиокниг в библиотеке');
    Logger.verbose('Возможные причины:');
    Logger.verbose('   - В вашей библиотеке нет аудиокниг с сериями');
    Logger.verbose('   - Все ваши аудиокниги являются отдельными произведениями');
    Logger.verbose('   - Проблема с получением данных из API');
    Logger.info('Попробуйте:');
    Logger.info('   - Добавить в библиотеку аудиокниги из серий');
    Logger.info('   - Проверить статус авторизации: at-cli status');
    return;
  }
  
  Logger.success(`Найдено серий: ${series.length}`);
  
  for (const s of series) {
    Logger.info(`📖 ${s.title}`);
    Logger.verbose(`   Аудиокниг: ${s.worksCount} (завершено: ${s.completedWorksCount})`);
    Logger.verbose(`   ID серии: ${s.id}`);
  }
}

async function listDownloadedSeries(outputDir: string) {
  Logger.info('Скачанные серии:');
  
  const series = await downloadManager.getDownloadedSeries(outputDir);
  if (series.length === 0) {
    Logger.warn('Скачанные серии не найдены');
    return;
  }
  
  for (const seriesName of series) {
    const seriesInfo = await downloadManager.getDownloadedSeriesInfo(outputDir, seriesName);
    if (seriesInfo) {
      Logger.info(`📖 ${seriesInfo.name}`);
      Logger.verbose(`   Книг: ${seriesInfo.totalBooks}`);
    }
  }
}

async function showSeriesInfo(seriesName: string) {
  await ensureAuthenticated();
  
  Logger.verbose(`Ищем серию: ${seriesName}`);
  
  const series = await api.findSeriesByTitle(seriesName);
  if (!series) {
    Logger.error(`Серия "${seriesName}" не найдена`);
    return;
  }
  
  const seriesDetails = await api.getSeriesDetails(series.id);
  if (!seriesDetails) {
    Logger.error('Не удалось получить детали серии');
    return;
  }
  
  Logger.info(`📖 Серия: ${seriesDetails.title}`);
  Logger.verbose(`Всего аудиокниг: ${seriesDetails.totalWorks}`);
  Logger.verbose(`Завершено: ${seriesDetails.completedWorks}`);
  
  Logger.info('Аудиокниги в серии:');
  for (let i = 0; i < seriesDetails.works.length; i++) {
    const book = seriesDetails.works[i];
    const status = book.isFinished ? '✓' : '○';
    const order = book.seriesOrder ? `[${book.seriesOrder}] ` : '';
    Logger.info(`  ${status} ${order}${book.title}`);
    Logger.verbose(`    Автор: ${book.authorFIO}`);
    if (book.reciter) {
      Logger.verbose(`    Чтец: ${book.reciter}`);
    }
  }
}

async function debugLibrary() {
  await ensureAuthenticated();
  
  Logger.info('Отладка библиотеки пользователя...');
  
  try {
    // Используем существующий метод API
    const allBooks = await api.getAudioBooks(1, 1000);
    Logger.success(`Всего аудиокниг в библиотеке: ${allBooks.length}`);
    
    if (allBooks.length === 0) {
      Logger.warn('Библиотека пуста');
      return;
    }
    
    Logger.info('Первые 10 аудиокниг:');
    allBooks.slice(0, 10).forEach((book, index) => {
      Logger.verbose(`${index + 1}. "${book.title}"`);
      Logger.verbose(`   Автор: ${book.authorFIO || 'Не указан'}`);
      Logger.verbose(`   Чтец: ${book.reciter || 'Не указан'}`);
      Logger.verbose(`   Серия: ${book.seriesTitle || 'Нет'}`);
      Logger.verbose(`   Порядок в серии: ${book.seriesOrder || 'Нет'}`);
      Logger.verbose(`   Завершена: ${book.isFinished ? 'Да' : 'Нет'}`);
    });
    
    // Статистика
    const booksWithSeries = allBooks.filter(book => book.seriesTitle);
    const finishedBooks = allBooks.filter(book => book.isFinished);
    
    Logger.info('Статистика:');
    Logger.verbose(`   Всего аудиокниг: ${allBooks.length}`);
    Logger.verbose(`   Аудиокниги с сериями: ${booksWithSeries.length}`);
    Logger.verbose(`   Завершенные аудиокниги: ${finishedBooks.length}`);
    
    if (booksWithSeries.length > 0) {
      Logger.info('Аудиокниги с сериями:');
      booksWithSeries.forEach(book => {
        Logger.verbose(`   "${book.title}" -> "${book.seriesTitle}" (порядок: ${book.seriesOrder || 'не указан'})`);
      });
    }
    
  } catch (error) {
    Logger.error('Ошибка получения библиотеки:', error);
  }
}

async function showInteractiveMenu() {
  Logger.info('🎧 Author Today CLI');
  Logger.verbose('Интерактивное меню');

  // Показываем статус авторизации
  if (api.isAuthenticated()) {
    Logger.success('Вы авторизованы');
  } else {
    Logger.error('Вы не авторизованы');
  }

  const choices: { name: string; value: string }[] = [];

  // Добавляем функциональные команды только для авторизованных пользователей
  if (api.isAuthenticated()) {
    choices.push(
      { name: '🔍 Поиск и скачивание аудиокниг', value: 'search' },
      { name: '📖 Скачать книгу по ID', value: 'download' },
      { name: '📚 Скачать серию', value: 'download-series' },
      { name: '📋 Показать мои серии', value: 'list-series' },
      { name: '💾 Показать скачанные книги', value: 'list-downloaded' },
      { name: '📁 Показать скачанные серии', value: 'list-downloaded-series' },
      { name: 'ℹ️  Информация о серии', value: 'show-series' },
      { name: '👤 Показать статус авторизации', value: 'status' },
      { name: '🚪 Выйти из системы', value: 'logout' }
    );
  } else {
    choices.push({ name: '🔐 Авторизация', value: 'login' });
  }

  choices.push({ name: '❌ Выход', value: 'exit' });

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Что хотите сделать?',
      choices
    }
  ]);

  switch (action) {
    case 'login':
      await loginUser();
      break;
    case 'logout':
      await api.logout();
      break;
    case 'status':
      await showAuthStatus();
      break;
    case 'search':
      await searchAndDownload({ output: './audiobooks' });
      break;
    case 'list-downloaded':
      await listDownloadedBooks('./audiobooks');
      break;
    case 'download':
      const { bookId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'bookId',
          message: 'Введите ID книги:',
          validate: (input) => !isNaN(parseInt(input)) || 'Введите корректный ID'
        }
      ]);
      await downloadBookById(parseInt(bookId), { output: './audiobooks' });
      break;
    case 'download-series':
      // Сначала показываем доступные серии
      const allSeries = await api.getUserSeries();
      if (allSeries.length === 0) {
        Logger.error('У вас нет серий аудиокниг в библиотеке');
        break;
      }
      
      Logger.info('Доступные серии аудиокниг:');
      allSeries.forEach((s, index) => {
        Logger.verbose(`   ${index + 1}. ${s.title} (${s.worksCount} аудиокниг)`);
      });
      
      const { seriesChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'seriesChoice',
          message: 'Выберите серию для скачивания:',
        choices: allSeries.map(s => ({
          name: `${s.title} (${s.worksCount} аудиокниг)`,
          value: s.title
        }))
        }
      ]);
      
      await downloadSeriesByName(seriesChoice, { output: './audiobooks' });
      break;
    case 'list-series':
      await listUserSeries();
      break;
    case 'list-downloaded-series':
      await listDownloadedSeries('./audiobooks');
      break;
    case 'show-series':
      const { seriesNameForInfo } = await inquirer.prompt([
        {
          type: 'input',
          name: 'seriesNameForInfo',
          message: 'Введите название серии:',
          validate: (input) => input.length > 0 || 'Введите название серии'
        }
      ]);
      await showSeriesInfo(seriesNameForInfo);
      break;
    case 'exit':
      Logger.success('До свидания! 👋');
      process.exit(0);
  }
}

// Если запущено без команд или только с флагами, показываем интерактивное меню
const hasCommands = process.argv.some(arg => 
  !arg.startsWith('-') && 
  arg !== 'node' && 
  !arg.includes('ts-node') && 
  !arg.includes('index.ts')
);

if (!hasCommands) {
  // Проверяем, есть ли флаг --verbose в аргументах
  const hasVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  setVerboseMode(hasVerbose);
  showInteractiveMenu().catch(console.error);
} else {
  program.parse();
}
