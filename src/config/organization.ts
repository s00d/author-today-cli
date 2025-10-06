import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { OrganizationConfig } from '../types';

export class OrganizationConfigManager {
  private configFile: string;
  private defaultConfig: OrganizationConfig = {
    bySeries: true,
    seriesFolderTemplate: '{series}',
    workFolderTemplate: '{order:03d}. {title}',
    standaloneFolder: 'Отдельные книги',
    maxFolderNameLength: 100,
    sanitizeNames: true
  };

  constructor() {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.config', 'author-today-cli');
    this.configFile = path.join(configDir, 'organization-config.json');
    
    // Создаем папку конфигурации если её нет
    fs.ensureDirSync(configDir);
  }

  /**
   * Загрузить конфигурацию
   */
  async loadConfig(): Promise<OrganizationConfig> {
    try {
      if (await fs.pathExists(this.configFile)) {
        const config = await fs.readJSON(this.configFile);
        return { ...this.defaultConfig, ...config };
      }
    } catch (error) {
      console.warn('Не удалось загрузить конфигурацию организации, используем настройки по умолчанию');
    }
    
    return this.defaultConfig;
  }

  /**
   * Сохранить конфигурацию
   */
  async saveConfig(config: OrganizationConfig): Promise<void> {
    try {
      await fs.writeJSON(this.configFile, config, { spaces: 2 });
    } catch (error) {
      console.error('Не удалось сохранить конфигурацию организации:', error);
    }
  }

  /**
   * Получить конфигурацию по умолчанию
   */
  getDefaultConfig(): OrganizationConfig {
    return { ...this.defaultConfig };
  }

  /**
   * Объединить конфигурацию с настройками по умолчанию
   */
  mergeWithDefaults(partialConfig: Partial<OrganizationConfig>): OrganizationConfig {
    return { ...this.defaultConfig, ...partialConfig };
  }

  /**
   * Валидировать конфигурацию
   */
  validateConfig(config: OrganizationConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.maxFolderNameLength < 10) {
      errors.push('Максимальная длина имени папки должна быть не менее 10 символов');
    }

    if (config.maxFolderNameLength > 255) {
      errors.push('Максимальная длина имени папки не должна превышать 255 символов');
    }

    if (!config.seriesFolderTemplate || config.seriesFolderTemplate.trim() === '') {
      errors.push('Шаблон папки серии не может быть пустым');
    }

    if (!config.workFolderTemplate || config.workFolderTemplate.trim() === '') {
      errors.push('Шаблон папки книги не может быть пустым');
    }

    if (!config.standaloneFolder || config.standaloneFolder.trim() === '') {
      errors.push('Название папки для отдельных книг не может быть пустым');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Создать конфигурацию из шаблонов
   */
  createConfigFromTemplates(
    seriesTemplate: string,
    workTemplate: string,
    standaloneFolder: string = 'Отдельные книги',
    maxLength: number = 100
  ): OrganizationConfig {
    return {
      bySeries: true,
      seriesFolderTemplate: seriesTemplate,
      workFolderTemplate: workTemplate,
      standaloneFolder,
      maxFolderNameLength: maxLength,
      sanitizeNames: true
    };
  }

  /**
   * Получить предустановленные шаблоны
   */
  getPresetTemplates(): Record<string, { series: string; work: string; description: string }> {
    return {
      'default': {
        series: '{series}',
        work: '{order:03d}. {title}',
        description: 'По умолчанию: Серия/001. Название книги'
      },
      'author-first': {
        series: '{author} - {series}',
        work: '{order:03d}. {title}',
        description: 'Сначала автор: Автор - Серия/001. Название книги'
      },
      'simple': {
        series: '{series}',
        work: '{title}',
        description: 'Простой: Серия/Название книги'
      },
      'numbered': {
        series: '{series}',
        work: '{order}. {title}',
        description: 'Нумерованный: Серия/1. Название книги'
      },
      'detailed': {
        series: '{series}',
        work: '{order:03d}. {title} - {author}',
        description: 'Подробный: Серия/001. Название книги - Автор'
      }
    };
  }
}
