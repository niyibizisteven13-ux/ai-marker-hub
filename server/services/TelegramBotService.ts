import logger from '../utils/logger.js';

export interface TelegramKeyboardOption {
  text: string;
  callback_data?: string;
  url?: string;
}

export class TelegramBotService {
  private static instance: TelegramBotService;
  private botToken: string;

  private constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  }

  public static getInstance(): TelegramBotService {
    if (!TelegramBotService.instance) {
      TelegramBotService.instance = new TelegramBotService();
    }
    return TelegramBotService.instance;
  }

  public isConfigured(): boolean {
    return Boolean(this.botToken && this.botToken.trim().length > 0);
  }

  /**
   * Sends a text message to a Telegram chat.
   */
  public async sendMessage(
    chatId: string | number,
    text: string,
    options: { parse_mode?: 'Markdown' | 'HTML'; reply_markup?: any } = {}
  ): Promise<any> {
    if (!this.isConfigured()) {
      logger.warn('TelegramBotService: TELEGRAM_BOT_TOKEN is not configured.');
      return null;
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const body: any = {
        chat_id: String(chatId),
        text,
        parse_mode: options.parse_mode || 'Markdown',
      };

      if (options.reply_markup) {
        body.reply_markup = options.reply_markup;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data: any = await res.json();
      if (!data.ok) {
        // Fallback without Markdown if markdown formatting was malformed
        if (options.parse_mode && data.description?.includes('can\'t parse entities')) {
          return this.sendMessage(chatId, text, { ...options, parse_mode: undefined });
        }
        logger.error('Telegram sendMessage error:', data);
      }
      return data.result;
    } catch (err) {
      logger.error('Telegram sendMessage failed:', err);
      return null;
    }
  }

  /**
   * Edits an existing message (used for real-time response streaming).
   */
  public async editMessageText(
    chatId: string | number,
    messageId: number,
    text: string,
    options: { parse_mode?: 'Markdown' | 'HTML'; reply_markup?: any } = {}
  ): Promise<any> {
    if (!this.isConfigured()) return null;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/editMessageText`;
      const body: any = {
        chat_id: String(chatId),
        message_id: messageId,
        text,
        parse_mode: options.parse_mode || 'Markdown',
      };

      if (options.reply_markup) {
        body.reply_markup = options.reply_markup;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data: any = await res.json();
      if (!data.ok && options.parse_mode && data.description?.includes('can\'t parse entities')) {
        return this.editMessageText(chatId, messageId, text, { ...options, parse_mode: undefined });
      }
      return data.result;
    } catch (err) {
      logger.error('Telegram editMessageText failed:', err);
      return null;
    }
  }

  /**
   * Sends a typing or uploading status indicator.
   */
  public async sendChatAction(chatId: string | number, action: 'typing' | 'upload_document' = 'typing'): Promise<void> {
    if (!this.isConfigured()) return;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendChatAction`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(chatId), action }),
      });
    } catch (err) {
      logger.warn('Telegram sendChatAction failed:', err);
    }
  }

  /**
   * Sends a document file (Excel, PDF, image) to a Telegram chat.
   */
  public async sendDocument(
    chatId: string | number,
    fileInput: Buffer | string,
    filename: string,
    caption?: string
  ): Promise<any> {
    if (!this.isConfigured()) return null;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendDocument`;
      const form = new FormData();
      form.append('chat_id', String(chatId));

      if (typeof fileInput === 'string' && (fileInput.startsWith('http://') || fileInput.startsWith('https://'))) {
        form.append('document', fileInput);
      } else {
        const buffer = typeof fileInput === 'string' ? Buffer.from(fileInput, 'utf-8') : fileInput;
        const blob = new Blob([buffer]);
        form.append('document', blob, filename);
      }

      if (caption) {
        form.append('caption', caption);
        form.append('parse_mode', 'Markdown');
      }

      const res = await fetch(url, {
        method: 'POST',
        body: form,
      });

      const data: any = await res.json();
      if (!data.ok) {
        logger.error('Telegram sendDocument error:', data);
      }
      return data.result;
    } catch (err) {
      logger.error('Telegram sendDocument failed:', err);
      return null;
    }
  }

  /**
   * Sends a voice note audio message to a Telegram chat.
   */
  public async sendVoice(
    chatId: string | number,
    voiceBuffer: Buffer,
    caption?: string
  ): Promise<any> {
    if (!this.isConfigured()) return null;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendVoice`;
      const form = new FormData();
      form.append('chat_id', String(chatId));
      const blob = new Blob([voiceBuffer]);
      form.append('voice', blob, 'voice_note.ogg');

      if (caption) {
        form.append('caption', caption);
        form.append('parse_mode', 'Markdown');
      }

      const res = await fetch(url, {
        method: 'POST',
        body: form,
      });

      const data: any = await res.json();
      if (!data.ok) {
        logger.error('Telegram sendVoice error:', data);
      }
      return data.result;
    } catch (err) {
      logger.error('Telegram sendVoice failed:', err);
      return null;
    }
  }

  /**
   * Transcribes a Telegram voice note audio buffer into text using Whisper API.
   */
  public async transcribeVoiceAudio(audioBuffer: Buffer): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      logger.warn('transcribeVoiceAudio: OPENAI_API_KEY is not configured for Whisper STT.');
      return '';
    }

    try {
      const form = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
      form.append('file', blob, 'audio.ogg');
      form.append('model', 'whisper-1');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      });

      const data: any = await res.json();
      if (!res.ok) {
        logger.error('Whisper STT transcription failed:', data);
        return '';
      }

      return (data.text || '').trim();
    } catch (err) {
      logger.error('Whisper STT error:', err);
      return '';
    }
  }

  /**
   * Downloads a document or photo uploaded to Telegram by file_id.
   */
  public async downloadTelegramFile(fileId: string): Promise<{ buffer: Buffer; filePath: string } | null> {
    if (!this.isConfigured()) return null;

    try {
      const getFileUrl = `https://api.telegram.org/bot${this.botToken}/getFile?file_id=${fileId}`;
      const res = await fetch(getFileUrl);
      const data: any = await res.json();

      if (!data.ok || !data.result?.file_path) {
        logger.error('Telegram getFile failed:', data);
        return null;
      }

      const filePath = data.result.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
      const fileRes = await fetch(downloadUrl);
      const buffer = Buffer.from(await fileRes.arrayBuffer());

      return { buffer, filePath };
    } catch (err) {
      logger.error('Telegram downloadTelegramFile failed:', err);
      return null;
    }
  }

  /**
   * Registers all available bot commands with Telegram so they appear in the user's command autocomplete menu.
   */
  public async registerCommands(): Promise<boolean> {
    if (!this.isConfigured()) return false;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/setMyCommands`;
      const commands = [
        { command: 'start', description: 'Welcome message & main menu' },
        { command: 'help', description: 'Show instructions and bot commands' },
        { command: 'grade', description: 'Batch grade exam papers against rubric' },
        { command: 'markphoto', description: 'Grade single handwritten student answer photo' },
        { command: 'discuss', description: 'Ask follow-up questions about graded batch' },
        { command: 'exam', description: 'Generate exam paper and marking rubric' },
        { command: 'research', description: 'Perform deep web research on any topic' },
        { command: 'form', description: 'Create online application or assessment form' },
        { command: 'scan', description: 'Open mobile web scanner for large file uploads' },
        { command: 'model', description: 'Switch AI provider (Gemini, Claude, Llama)' },
        { command: 'status', description: 'View recent batch jobs and processing status' },
        { command: 'quota', description: 'Check remaining paper quota and plan' },
        { command: 'english', description: 'Switch bot language to English' },
        { command: 'kinyarwanda', description: 'Ururimi ruhinduwe mu Kinyarwanda' }
      ];

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands }),
      });

      const data: any = await res.json();
      if (data.ok) {
        logger.info('TelegramBotService: Successfully registered bot commands with Telegram.');
        return true;
      } else {
        logger.warn('TelegramBotService: Failed to register bot commands:', data);
        return false;
      }
    } catch (err) {
      logger.error('TelegramBotService: registerCommands failed:', err);
      return false;
    }
  }

  /**
   * Sets the Telegram webhook URL so Telegram routes incoming updates to this server.
   */
  public async setWebhook(webhookUrl: string): Promise<boolean> {
    if (!this.isConfigured()) return false;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/setWebhook`;
      const secretToken = process.env.TELEGRAM_BOT_SECRET_TOKEN;

      const body: any = { url: `${webhookUrl.replace(/\/$/, '')}/api/telegram/webhook` };
      if (secretToken) {
        body.secret_token = secretToken;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data: any = await res.json();
      if (data.ok) {
        logger.info(`TelegramBotService: Successfully set webhook to ${body.url}`);
        return true;
      } else {
        logger.warn('TelegramBotService: Failed to set webhook:', data);
        return false;
      }
    } catch (err) {
      logger.error('TelegramBotService: setWebhook failed:', err);
      return false;
    }
  }
}
