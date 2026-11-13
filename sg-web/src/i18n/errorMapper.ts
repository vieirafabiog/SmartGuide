import i18n, { getActiveLocale } from '@/i18n';
import { ApiError } from '@/services/apiClient';

export function translateApiError(
  err: unknown,
  fallbackKey = 'errors.unknownError',
): string {
  if (err instanceof ApiError) {
    if (err.errorCode) {
      const codeKey = `errors.apiCodes.${err.errorCode}`;
      if (i18n.exists(codeKey)) {
        return i18n.t(codeKey);
      }
    }

    if (err.status === 401) return i18n.t('errors.unauthorized');
    if (err.status === 403) return i18n.t('errors.forbidden');
    if (err.status === 404) return i18n.t('errors.notFound');
    if (err.status === 400 || err.status === 422) {
      return err.message || i18n.t('errors.validationError');
    }
    if (err.status >= 500) return i18n.t('errors.serverError');
    if (err.message) return err.message;
  }

  if (err instanceof Error) {
    if (err.name === 'AbortError') return i18n.t('errors.timeoutError');
    if (err.name === 'TypeError' && /network|fetch/i.test(err.message)) {
      return i18n.t('errors.networkError');
    }
    if (err.message) return err.message;
  }

  return i18n.t(fallbackKey);
}

export function formatLocalizedDate(
  dateInput: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'short',
    timeStyle: 'short',
  },
): string {
  if (dateInput === null || dateInput === undefined || dateInput === '') {
    return '-';
  }
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return String(dateInput);
  }
  try {
    return new Intl.DateTimeFormat(getActiveLocale(), options).format(date);
  } catch {
    return date.toISOString();
  }
}
