/**
 * Optional phone: 10-15 digits. Rejects emails and other non-phone text.
 */

export function normalizePhoneDigits(phone) {
  if (phone == null) return '';
  const raw = String(phone).trim();
  if (!raw || raw.includes('@')) return '';
  return raw.replace(/\D/g, '');
}

/** Value safe to show in a phone input (hides mistaken emails in DB). */
export function phoneForInput(stored) {
  const digits = normalizePhoneDigits(stored);
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return '';
}

export function validateOptionalPhone(phone) {
  const raw = String(phone ?? '').trim();
  if (!raw) return null;
  if (raw.includes('@')) {
    return 'Phone cannot be an email address. Enter 10-15 digits or leave blank.';
  }
  const digits = normalizePhoneDigits(raw);
  if (!digits) return 'Phone number must be 10-15 digits';
  if (digits.length < 10 || digits.length > 15) {
    return 'Phone number must be 10-15 digits';
  }
  return null;
}

/** Payload field for API (digits only, or omit when empty). */
export function phoneForApi(phone) {
  const digits = normalizePhoneDigits(phone);
  return digits || undefined;
}
