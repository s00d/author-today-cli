# Author Today CLI

[![npm version](https://img.shields.io/npm/v/author-today-cli/latest?style=for-the-badge)](https://www.npmjs.com/package/author-today-cli)
[![GitHub issues](https://img.shields.io/github/issues/s00d/author-today-cli?style=for-the-badge)](https://github.com/s00d/author-today-cli/issues)
[![GitHub stars](https://img.shields.io/github/stars/s00d/author-today-cli?style=for-the-badge)](https://github.com/s00d/author-today-cli/stargazers)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](https://github.com/s00d/author-today-cli/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-16%2B-green?style=for-the-badge)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-blue?style=for-the-badge)](https://www.typescriptlang.org/)
[![Donate](https://img.shields.io/badge/Donate-Donationalerts-ff4081?style=for-the-badge)](https://www.donationalerts.com/r/s00d88)

🎧 CLI инструмент для загрузки аудиокниг с платформы Author Today

## ⚠️ Важная информация

**Этот инструмент предназначен исключительно для личного использования!**

- 📚 **Только для купленных книг** - Инструмент позволяет скачивать только те аудиокниги, которые вы приобрели на платформе Author Today
- 🔒 **Личное использование** - Скачанные файлы предназначены только для личного прослушивания
- 🚫 **Запрет передачи** - Строго запрещается передача скачанных аудиокниг третьим лицам
- 🌐 **Публичное API** - Инструмент использует официальное публичное API платформы Author Today
- ⚖️ **Соблюдение авторских прав** - Пользователь несет полную ответственность за соблюдение авторских прав и условий использования платформы

## Установка

```bash
npm install -g author-today-cli
```

или

```bash
pnpm add -g author-today-cli
```

## Использование

### Интерактивный режим

```bash
at-cli
```

### Команды

```bash
# Авторизация
at-cli login

# Показать статус авторизации
at-cli status

# Поиск и скачивание аудиокниг
at-cli search

# Поиск с фильтром
at-cli search --query "фантастика"

# Скачивание с настройкой потоков
at-cli search --concurrent 5

# Скачивание с настройкой попыток при ошибке
at-cli search --retries 5

# Скачивание в определенную папку
at-cli search --output ./my-books --concurrent 3 --retries 3

# Выход из системы
at-cli logout
```

### Опции команд

```bash
# Скачивание с указанием папки
at-cli download 12345 --output ./my-books

# Поиск с фильтром
at-cli search --query "фантастика"

# Настройка количества одновременных загрузок
at-cli download 12345 --concurrent 5
```

## Возможности

- ✅ **Авторизация** - Сохранение токена и автоматическое обновление
- ✅ **Поиск аудиокниг** - Интерактивный поиск с фильтрацией
- ✅ **Многопоточное скачивание** - Параллельная загрузка нескольких глав
- ✅ **Автоматические повторы** - Повторные попытки при ошибках скачивания
- ✅ **Скачивание** - Загрузка аудиофайлов с прогрессом
- ✅ **Возобновление** - Продолжение прерванных загрузок
- ✅ **Обложки** - Автоматическое скачивание обложек книг
- ✅ **Метаданные** - Сохранение информации о книгах
- ✅ **Временные файлы** - Безопасное скачивание через временные файлы
- ✅ **2FA поддержка** - Двухфакторная аутентификация

## Структура скачанных файлов

```
downloads/
├── Название книги 1/
│   ├── book-info.json          # Информация о книге
│   ├── cover.jpg                # Обложка книги
│   ├── annotation.txt           # Аннотация (если есть)
│   ├── 001. Глава 1.mp3         # Аудиофайлы глав
│   ├── 002. Глава 2.mp3
│   └── ...
├── Название книги 2/
│   ├── book-info.json
│   ├── cover.png
│   └── ...
```

## Авторизация

CLI автоматически сохраняет токен авторизации в системной папке пользователя:
- **Linux/macOS**: `~/.config/author-today-cli/auth-token.json`
- **Windows**: `%USERPROFILE%\.config\author-today-cli\auth-token.json`

При повторном запуске токен загружается автоматически.

### Поддерживаемые методы авторизации

- Логин/пароль
- Двухфакторная аутентификация (2FA)
- Автоматическое обновление токенов

## Требования

- Node.js >= 16.0.0
- Аккаунт на [Author Today](https://author.today)

## Разработка

```bash
# Клонирование репозитория
git clone https://github.com/s00d/author-today-cli.git
cd author-today-cli

# Установка зависимостей
pnpm install

# Сборка
pnpm run build

# Запуск в режиме разработки
pnpm run dev
```

## Лицензия

MIT License

**Важно:** Использование данного инструмента подразумевает согласие с условиями использования платформы Author Today и соблюдение авторских прав. Пользователь несет полную ответственность за правомерность использования скачанных материалов.

## Поддержка

Если у вас возникли проблемы или вопросы:

1. Проверьте [Issues](https://github.com/s00d/author-today-cli/issues)
2. Создайте новый Issue с описанием проблемы
3. Убедитесь, что у вас актуальная версия Node.js

## Changelog

### v1.0.0
- Первый релиз
- Базовая функциональность скачивания аудиокниг
- Интерактивный поиск и выбор
- Автоматическое скачивание обложек
- Поддержка возобновления загрузок
- Временные файлы для безопасного скачивания