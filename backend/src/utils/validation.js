export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePhoneNumber = (phoneNumber) => {
  if (phoneNumber == null) return true; // optional
  const raw = String(phoneNumber).trim();
  if (!raw) return true; // optional

  // Numeric only (digits). Optional field, but if present it must be 10-15 digits.
  // (E.164 typically maxes at 15 digits; we intentionally disallow '+'.)
  const numericOnly = /^[0-9]{10,15}$/;
  if (!numericOnly.test(raw)) return false;

  return true;
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

  // phoneNumber is optional, but if provided it must be valid.
  const phone = userDTO.phoneNumber ?? userDTO.phone_number;
  if (!validatePhoneNumber(phone)) {
    errors.push('Phone number must be 10-15 digits (optionally starting with +)');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};











