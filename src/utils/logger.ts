import chalk from 'chalk';

// Глобальная переменная для verbose режима
let verboseMode = false;

export function setVerboseMode(enabled: boolean) {
  verboseMode = enabled;
}

export function isVerboseMode(): boolean {
  return verboseMode;
}

export class Logger {
  /**
   * Обычный лог (всегда показывается)
   */
  static log(message: string, ...args: any[]) {
    console.log(message, ...args);
  }

  /**
   * Информационный лог (всегда показывается)
   */
  static info(message: string, ...args: any[]) {
    console.log(chalk.blue('ℹ️ '), message, ...args);
  }

  /**
   * Успешный лог (всегда показывается)
   */
  static success(message: string, ...args: any[]) {
    console.log(chalk.green('✅'), message, ...args);
  }

  /**
   * Предупреждение (всегда показывается)
   */
  static warn(message: string, ...args: any[]) {
    console.log(chalk.yellow('⚠️ '), message, ...args);
  }

  /**
   * Ошибка (всегда показывается)
   */
  static error(message: string, ...args: any[]) {
    console.log(chalk.red('❌'), message, ...args);
  }

  /**
   * Подробный лог (только в verbose режиме)
   */
  static verbose(message: string, ...args: any[]) {
    if (verboseMode) {
      console.log(chalk.gray('🔍'), message, ...args);
    }
  }

  /**
   * Отладочный лог (только в verbose режиме)
   */
  static debug(message: string, ...args: any[]) {
    if (verboseMode) {
      console.log(chalk.magenta('🐛'), message, ...args);
    }
  }

  /**
   * Прогресс (только в verbose режиме)
   */
  static progress(message: string, ...args: any[]) {
    if (verboseMode) {
      console.log(chalk.cyan('⏳'), message, ...args);
    }
  }

  /**
   * HTTP запрос (только в verbose режиме)
   */
  static http(method: string, url: string, ...args: any[]) {
    if (verboseMode) {
      console.log(chalk.blue('🌐'), `${method.toUpperCase()} ${url}`, ...args);
    }
  }

  /**
   * API ответ (только в verbose режиме)
   */
  static apiResponse(status: number, url: string, ...args: any[]) {
    if (verboseMode) {
      const color = status >= 200 && status < 300 ? chalk.green : chalk.red;
      console.log(color('📡'), `${status} ${url}`, ...args);
    }
  }

  /**
   * Файловая операция (только в verbose режиме)
   */
  static file(operation: string, path: string, ...args: any[]) {
    if (verboseMode) {
      console.log(chalk.yellow('📁'), `${operation} ${path}`, ...args);
    }
  }

  /**
   * Скачивание (только в verbose режиме)
   */
  static download(message: string, ...args: any[]) {
    if (verboseMode) {
      console.log(chalk.green('⬇️ '), message, ...args);
    }
  }

  /**
   * Создание папки (только в verbose режиме)
   */
  static mkdir(path: string) {
    if (verboseMode) {
      console.log(chalk.blue('📂'), `Создаем папку: ${path}`);
    }
  }

  /**
   * Очистка (только в verbose режиме)
   */
  static cleanup(message: string, ...args: any[]) {
    if (verboseMode) {
      console.log(chalk.gray('🧹'), message, ...args);
    }
  }
}
