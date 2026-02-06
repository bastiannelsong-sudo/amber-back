/**
 * Shared date utilities for MercadoLibre API date parsing.
 */

const TIMEZONE_REGEX = /([+-]\d{2}:\d{2}|Z)$/;

/**
 * Parse a date string from MercadoLibre API, ensuring Chile timezone (-04:00) is applied.
 * ML dates may come with or without timezone info. When missing, we assume -04:00.
 * This prevents timezone misinterpretation when the server runs in UTC.
 *
 * @param dateStr - Date string from MercadoLibre API
 * @returns Date object with correct timezone interpretation
 */
export function parseMLDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();
  const hasTimezone = TIMEZONE_REGEX.test(dateStr);
  if (hasTimezone) return new Date(dateStr);
  return new Date(`${dateStr}-04:00`);
}
