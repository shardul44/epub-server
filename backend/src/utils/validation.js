export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Normalize optional phone to digits only, or null when empty / clearly not a phone (e.g. email pasted).
 * @returns {{ value: string|null|undefined, error: string|null }}
 */
export const sanitizePhoneField = (phoneNumber) => {
  if (phoneNumber == null) return { value: undefined, error: null };
  const raw = String(phoneNumber).trim();
  if (!raw) return { value: null, error: null };
  if (raw.includes('@')) {
    return {
      value: null,
      error: 'Phone cannot be an email address. Enter 10-15 digits or leave blank.',
    };
  }
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    return { value: null, error: 'Phone number must be 10-15 digits' };
  }
  if (digits.length < 10 || digits.length > 15) {
    return { value: null, error: 'Phone number must be 10-15 digits' };
  }
  return { value: digits, error: null };
};

export const validatePhoneNumber = (phoneNumber) => {
  const { error } = sanitizePhoneField(phoneNumber);
  return !error;
};

export const validatePassword = (password) => {
  if (!password) return false;
  const pwd = String(password);

  // Basic strength: min length + includes at least one letter and one number.
  if (pwd.length < 6) return false;
  const hasLetter = /[A-Za-z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  return hasLetter && hasNumber;
};

export const validateUserDTO = (userDTO) => {
  const errors = [];

  if (!userDTO.name || userDTO.name.trim().length < 2 || userDTO.name.trim().length > 100) {
    errors.push('Name must be between 2 and 100 characters');
  }

  if (!userDTO.email || !validateEmail(userDTO.email)) {
    errors.push('Valid email is required');
  }

  if (!validatePassword(userDTO.password)) {
    errors.push('Password must be at least 6 characters and include letters and numbers');
  }

  const phoneKey = userDTO.phoneNumber !== undefined ? 'phoneNumber' : 'phone_number';
  const phone = userDTO.phoneNumber ?? userDTO.phone_number;
  if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
    const sanitized = sanitizePhoneField(phone);
    if (sanitized.error) errors.push(sanitized.error);
    else userDTO[phoneKey] = sanitized.value;
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/** Partial update — password optional */
export const validateUserUpdateDTO = (userDTO) => {
  const errors = [];

  if (userDTO.name !== undefined) {
    const n = String(userDTO.name).trim();
    if (n.length < 2 || n.length > 100) {
      errors.push('Name must be between 2 and 100 characters');
    }
  }

  if (userDTO.email !== undefined && !validateEmail(userDTO.email)) {
    errors.push('Valid email is required');
  }

  if (userDTO.password !== undefined && userDTO.password !== '') {
    if (!validatePassword(userDTO.password)) {
      errors.push('Password must be at least 6 characters and include letters and numbers');
    }
  }

  const phoneKey = userDTO.phoneNumber !== undefined ? 'phoneNumber' : 'phone_number';
  const phone = userDTO.phoneNumber ?? userDTO.phone_number;
  if (phone !== undefined) {
    if (phone === null || String(phone).trim() === '') {
      userDTO[phoneKey] = null;
    } else {
      const sanitized = sanitizePhoneField(phone);
      if (sanitized.error) errors.push(sanitized.error);
      else userDTO[phoneKey] = sanitized.value;
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};











