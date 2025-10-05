#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import { AuthorTodayAPI, LoginData } from './services/api';
import { DownloadManager } from './services/download';
import { AudioBook, DownloadOptions } from './types';
import { search } from '@inquirer/prompts';
import packageJson from '../package.json';

const program = new Command();
const api = new AuthorTodayAPI();
const downloadManager = new DownloadManager(api);

program
  .name('author-today-cli')
  .description('CLI для загрузки аудиокниг с Author Today')
  .version(packageJson.version);

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
  .option('-o, --output <dir>', 'Папка для скачивания', './downloads')
  .option('-c, --concurrent <number>', 'Количество одновременных загрузок', '3')
  .option('-r, --retries <number>', 'Количество попыток при ошибке', '3')
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
  .option('-o, --output <dir>', 'Папка с загрузками', './downloads')
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
  .option('-o, --output <dir>', 'Папка для скачивания', './downloads')
  .action(async (bookId, options) => {
    try {
      await downloadBookById(parseInt(bookId), options);
    } catch (error) {
      console.error(chalk.red('Ошибка:', error));
      process.exit(1);
    }
  });

async function loginUser(): Promise<void> {
  console.log(chalk.blue('🔐 Авторизация в Author Today'));
  
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
    console.log(chalk.blue('Выполняется авторизация...'));
    let loginData: LoginData = { login, password };
    let response = await api.login(loginData);
    
    // Проверяем, требуется ли 2FA
    if (response.data.twoFactorEnabled && !response.data.token) {
      console.log(chalk.yellow('⚠️  Требуется код двухфакторной аутентификации'));
      
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
      console.log(chalk.green('✅ Авторизация успешна!'));
      
      // Получаем информацию о пользователе
      try {
        const userResponse = await api.getCurrentUser();
        if (userResponse.data && typeof userResponse.data === 'object') {
          const userData = userResponse.data as Record<string, unknown>;
          const nickname = userData.nickname as string;
          const userLogin = userData.login as string;
          const displayName = nickname || userLogin || login;
          console.log(chalk.green(`Добро пожаловать, ${displayName}!`));
        }
      } catch (error) {
        console.log(chalk.green(`Добро пожаловать, ${login}!`));
      }
    }
  } catch (error: unknown) {
    console.log(chalk.red('❌ Ошибка авторизации:'));
    const axiosError = error as { response?: { data?: { message?: string; code?: string; invalidFields?: Record<string, string[]> } } };
    const apiError = axiosError.response?.data;
    
    if (apiError?.code === 'InvalidRequestFields' && apiError.invalidFields) {
      console.log(chalk.red('Ошибки валидации:'));
      Object.entries(apiError.invalidFields).forEach(([field, messages]) => {
        console.log(chalk.red(`${field}: ${messages.join(', ')}`));
      });
    } else if (apiError?.message) {
      console.log(chalk.red(apiError.message));
    } else {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      console.log(chalk.red(errorMessage));
    }
    throw error;
  }
}

async function showAuthStatus(): Promise<void> {
  if (api.isAuthenticated()) {
    console.log(chalk.green('✅ Вы авторизованы'));
    try {
      const userResponse = await api.getCurrentUser();
      if (userResponse.data && typeof userResponse.data === 'object') {
        const userData = userResponse.data as Record<string, unknown>;
        const nickname = userData.nickname as string;
        const login = userData.login as string;
        const displayName = nickname || login || 'Пользователь';
        console.log(chalk.green(`Пользователь: ${displayName}`));
      } else {
        console.log(chalk.green('Пользователь: Авторизован'));
      }
    } catch (error) {
      console.log(chalk.green('Пользователь: Авторизован'));
    }
  } else {
    console.log(chalk.red('❌ Вы не авторизованы'));
    console.log(chalk.yellow('Используйте команду "login" для авторизации'));
  }
}

async function ensureAuthenticated(): Promise<void> {
  if (!api.isAuthenticated()) {
    console.log(chalk.yellow('⚠️  Требуется авторизация'));
    await loginUser();
  }
}

async function searchAndDownload(options: { output: string; query?: string; concurrent?: string; retries?: string }) {
  // Проверяем авторизацию
  await ensureAuthenticated();
  
  console.log(chalk.blue('🔍 Поиск аудиокниг...'));
  
  // Создаем папку для загрузок
  await fs.ensureDir(options.output);

  let allBooks: AudioBook[] = [];
  let currentPage = 1;
  const pageSize = 50;
  let hasMorePages = true;

  // Загружаем все страницы
  while (hasMorePages) {
    console.log(chalk.gray(`Загружаем страницу ${currentPage}...`));
    
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
    console.log(chalk.yellow('Аудиокниги не найдены'));
    return;
  }

  console.log(chalk.green(`\n📚 Найдено аудиокниг: ${allBooks.length}`));

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
  console.log(chalk.blue('📖 Получаем детали книги...'));
  const bookDetails = await api.getAudioBookDetails(selectedBook.id);
  
  if (!bookDetails) {
    console.log(chalk.red('Не удалось получить детали книги'));
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
    maxRetries: parseInt(options.retries || '3')
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

async function downloadBookById(bookId: number, options: { output: string }) {
  console.log(chalk.blue(`📖 Получаем информацию о книге ID: ${bookId}`));
  
  const bookDetails = await api.getAudioBookDetails(bookId);
  
  if (!bookDetails) {
    console.log(chalk.red('Книга не найдена или недоступна'));
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
    concurrentDownloads: 3
  };

  // Скачиваем книгу
  await downloadManager.downloadAudioBook(bookDetails, downloadOptions);
}

async function showInteractiveMenu() {
  console.log(chalk.blue('🎧 Author Today CLI'));
  console.log(chalk.gray('Интерактивное меню\n'));

  // Показываем статус авторизации
  if (api.isAuthenticated()) {
    console.log(chalk.green('✅ Вы авторизованы'));
  } else {
    console.log(chalk.red('❌ Вы не авторизованы'));
  }
  console.log('');

  const choices: { name: string; value: string }[] = [];

  // Добавляем функциональные команды только для авторизованных пользователей
  if (api.isAuthenticated()) {
    choices.push(
      { name: '🔍 Поиск и скачивание аудиокниг', value: 'search' },
      { name: '📖 Скачать книгу по ID', value: 'download' },
      { name: '💾 Показать скачанные книги', value: 'list-downloaded' },
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
      await searchAndDownload({ output: './downloads' });
      break;
    case 'list-downloaded':
      await listDownloadedBooks('./downloads');
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
      await downloadBookById(parseInt(bookId), { output: './downloads' });
      break;
    case 'exit':
      console.log(chalk.green('До свидания! 👋'));
      process.exit(0);
  }
}

// Если запущено без команд, показываем интерактивное меню
if (process.argv.length === 2) {
  showInteractiveMenu().catch(console.error);
} else {
  program.parse();
}
