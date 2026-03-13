/* ========================================
   COMMUNITY Feature - Component Utilities
   ======================================== */

// ─────────────────────────────────────────
// FORM VALIDATION
// ─────────────────────────────────────────

interface ValidationError {
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  message: string;
}

class FormValidator {
  form: HTMLFormElement;
  errors: ValidationError[];

  constructor(form: HTMLFormElement) {
    this.form = form;
    this.errors = [];
  }

  validate(): boolean {
    this.errors = [];
    const inputs = this.form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[required]');

    inputs.forEach((input) => {
      if (!input.value.trim()) {
        this.addError(input, 'This field is required');
      } else if (input instanceof HTMLInputElement && input.type === 'email' && !this.isValidEmail(input.value)) {
        this.addError(input, 'Please enter a valid email');
      } else if (input instanceof HTMLInputElement && input.type === 'tel' && !this.isValidPhone(input.value)) {
        this.addError(input, 'Please enter a valid phone number');
      } else if (input instanceof HTMLInputElement && input.type === 'number' && Number(input.value) < Number(input.min)) {
        this.addError(input, `Minimum value is ${input.min}`);
      }
    });

    return this.errors.length === 0;
  }

  addError(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, message: string): void {
    this.errors.push({ input, message });
    this.showError(input, message);
  }

  showError(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, message: string): void {
    // Remove existing error
    const existingError: Element | null = input.parentElement?.querySelector('.error-message') || null;
    if (existingError) existingError.remove();

    // Add new error message
    const errorDiv: HTMLDivElement = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    errorDiv.style.color = 'var(--color-error)';
    errorDiv.style.fontSize = '0.875rem';
    errorDiv.style.marginTop = '0.25rem';

    input.parentElement?.appendChild(errorDiv);
    (input as HTMLElement).style.borderColor = 'var(--color-error)';
  }

  clearErrors(): void {
    this.errors = [];
    this.form.querySelectorAll('.error-message').forEach((el: Element) => el.remove());
    this.form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea').forEach((input) => {
      (input as HTMLElement).style.borderColor = '';
    });
  }

  isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  isValidPhone(phone: string): boolean {
    return /^[\d\s\-\+\(\)]+$/.test(phone);
  }
}

// ─────────────────────────────────────────
// DATE & TIME UTILITIES
// ─────────────────────────────────────────

class DateTimeUtils {
  static formatDate(date: string | Date): string {
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(date).toLocaleDateString('en-IN', options);
  }

  static formatTime(time: string | Date): string {
    const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    return new Date(time).toLocaleTimeString('en-IN', options);
  }

  static timeAgo(date: string | Date): string {
    const seconds: number = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);

    const intervals: Record<string, number> = {
      year: 31536000,
      month: 2592000,
      week: 604800,
      day: 86400,
      hour: 3600,
      minute: 60,
      second: 1
    };

    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
      const interval: number = Math.floor(seconds / secondsInUnit);
      if (interval >= 1) {
        return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
      }
    }

    return 'just now';
  }

  static getMinDate(): string {
    const today: Date = new Date();
    return today.toISOString().split('T')[0];
  }

  static getMaxDate(daysAhead: number = 7): string {
    const maxDate: Date = new Date();
    maxDate.setDate(maxDate.getDate() + daysAhead);
    return maxDate.toISOString().split('T')[0];
  }
}

// ─────────────────────────────────────────
// LOCATION UTILITIES
// ─────────────────────────────────────────

interface Coordinates {
  latitude: number;
  longitude: number;
}

class LocationUtils {
  static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R: number = 6371; // Earth's radius in km
    const dLat: number = this.toRad(lat2 - lat1);
    const dLon: number = this.toRad(lon2 - lon1);

    const a: number =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c: number = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance: number = R * c;

    return Math.round(distance * 10) / 10; // Round to 1 decimal
  }

  static toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  static async getCurrentLocation(): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position: GeolocationPosition) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error: GeolocationPositionError) => {
          reject(error);
        }
      );
    });
  }
}

// ─────────────────────────────────────────
// STORAGE UTILITIES
// ─────────────────────────────────────────

class StorageUtils {
  static save(key: string, value: unknown): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage error:', e);
      return false;
    }
  }

  static load(key: string): unknown {
    try {
      const item: string | null = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (e) {
      console.error('Storage error:', e);
      return null;
    }
  }

  static remove(key: string): boolean {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.error('Storage error:', e);
      return false;
    }
  }

  static clear(): boolean {
    try {
      localStorage.clear();
      return true;
    } catch (e) {
      console.error('Storage error:', e);
      return false;
    }
  }
}

// ─────────────────────────────────────────
// FILE UTILITIES
// ─────────────────────────────────────────

interface FileValidationResult {
  valid: boolean;
  error?: string;
}

class FileUtils {
  static async readAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader: FileReader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => resolve(e.target?.result as string);
      reader.onerror = (e: ProgressEvent<FileReader>) => reject(e);
      reader.readAsDataURL(file);
    });
  }

  static validateImage(file: File): FileValidationResult {
    const validTypes: string[] = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const maxSize: number = 5 * 1024 * 1024; // 5MB

    if (!validTypes.includes(file.type)) {
      return { valid: false, error: 'Invalid file type. Please upload an image.' };
    }

    if (file.size > maxSize) {
      return { valid: false, error: 'File too large. Maximum size is 5MB.' };
    }

    return { valid: true };
  }

  static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k: number = 1024;
    const sizes: string[] = ['Bytes', 'KB', 'MB', 'GB'];
    const i: number = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

// ─────────────────────────────────────────
// ANIMATION UTILITIES
// ─────────────────────────────────────────

class AnimationUtils {
  static fadeIn(element: HTMLElement, duration: number = 300): void {
    element.style.opacity = '0';
    element.style.display = 'block';

    let start: number | null = null;
    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress: number = timestamp - start;

      element.style.opacity = String(Math.min(progress / duration, 1));

      if (progress < duration) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }

  static fadeOut(element: HTMLElement, duration: number = 300): void {
    let start: number | null = null;
    const initialOpacity: number = parseFloat(getComputedStyle(element).opacity) || 1;

    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress: number = timestamp - start;

      element.style.opacity = String(initialOpacity * (1 - progress / duration));

      if (progress < duration) {
        requestAnimationFrame(animate);
      } else {
        element.style.display = 'none';
      }
    };

    requestAnimationFrame(animate);
  }

  static slideDown(element: HTMLElement, duration: number = 300): void {
    element.style.overflow = 'hidden';
    element.style.display = 'block';
    const height: number = element.scrollHeight;
    element.style.height = '0px';

    let start: number | null = null;
    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress: number = timestamp - start;

      element.style.height = String(Math.min(progress / duration * height, height)) + 'px';

      if (progress < duration) {
        requestAnimationFrame(animate);
      } else {
        element.style.height = '';
        element.style.overflow = '';
      }
    };

    requestAnimationFrame(animate);
  }

  static slideUp(element: HTMLElement, duration: number = 300): void {
    const height: number = element.scrollHeight;
    element.style.overflow = 'hidden';
    element.style.height = height + 'px';

    let start: number | null = null;
    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress: number = timestamp - start;

      element.style.height = String(height * (1 - progress / duration)) + 'px';

      if (progress < duration) {
        requestAnimationFrame(animate);
      } else {
        element.style.display = 'none';
        element.style.height = '';
        element.style.overflow = '';
      }
    };

    requestAnimationFrame(animate);
  }
}

// ─────────────────────────────────────────
// DEBOUNCE & THROTTLE HELPERS
// ─────────────────────────────────────────

function debounce(func: (...args: any[]) => void, wait: number): (...args: any[]) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function executedFunction(...args: any[]) {
    const later = () => {
      if (timeout) clearTimeout(timeout);
      func(...args);
    };
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function throttle(func: (...args: any[]) => void, limit: number): (...args: any[]) => void {
  let inThrottle: boolean = false;
  return function (...args: any[]) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// ─────────────────────────────────────────
// DOM READY HELPER
// ─────────────────────────────────────────

function ready(fn: () => void): void {
  if (document.readyState !== 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}
