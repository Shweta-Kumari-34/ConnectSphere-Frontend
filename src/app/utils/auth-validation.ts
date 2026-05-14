export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
export const USERNAME_REGEX = /^(?=.{3,20}$)[a-zA-Z0-9._]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}

export function isStrongPassword(value: string): boolean {
  return PASSWORD_REGEX.test(value);
}

export function isValidUsername(value: string): boolean {
  return USERNAME_REGEX.test(value.trim());
}

export function getPasswordChecks(password: string) {
  return {
    minLength: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password)
  };
}
