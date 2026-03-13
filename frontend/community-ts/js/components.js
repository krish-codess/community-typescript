/* ========================================
   COMMUNITY Feature - Component Utilities
   ======================================== */
class FormValidator {
    constructor(form) {
        this.form = form;
        this.errors = [];
    }
    validate() {
        this.errors = [];
        const inputs = this.form.querySelectorAll('[required]');
        inputs.forEach((input) => {
            if (!input.value.trim()) {
                this.addError(input, 'This field is required');
            }
            else if (input instanceof HTMLInputElement && input.type === 'email' && !this.isValidEmail(input.value)) {
                this.addError(input, 'Please enter a valid email');
            }
            else if (input instanceof HTMLInputElement && input.type === 'tel' && !this.isValidPhone(input.value)) {
                this.addError(input, 'Please enter a valid phone number');
            }
            else if (input instanceof HTMLInputElement && input.type === 'number' && Number(input.value) < Number(input.min)) {
                this.addError(input, `Minimum value is ${input.min}`);
            }
        });
        return this.errors.length === 0;
    }
    addError(input, message) {
        this.errors.push({ input, message });
        this.showError(input, message);
    }
    showError(input, message) {
        var _a, _b;
        // Remove existing error
        const existingError = ((_a = input.parentElement) === null || _a === void 0 ? void 0 : _a.querySelector('.error-message')) || null;
        if (existingError)
            existingError.remove();
        // Add new error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        errorDiv.style.color = 'var(--color-error)';
        errorDiv.style.fontSize = '0.875rem';
        errorDiv.style.marginTop = '0.25rem';
        (_b = input.parentElement) === null || _b === void 0 ? void 0 : _b.appendChild(errorDiv);
        input.style.borderColor = 'var(--color-error)';
    }
    clearErrors() {
        this.errors = [];
        this.form.querySelectorAll('.error-message').forEach((el) => el.remove());
        this.form.querySelectorAll('input, select, textarea').forEach((input) => {
            input.style.borderColor = '';
        });
    }
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
    isValidPhone(phone) {
        return /^[\d\s\-\+\(\)]+$/.test(phone);
    }
}
// ─────────────────────────────────────────
// DATE & TIME UTILITIES
// ─────────────────────────────────────────
class DateTimeUtils {
    static formatDate(date) {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return new Date(date).toLocaleDateString('en-IN', options);
    }
    static formatTime(time) {
        const options = { hour: '2-digit', minute: '2-digit' };
        return new Date(time).toLocaleTimeString('en-IN', options);
    }
    static timeAgo(date) {
        const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60,
            second: 1
        };
        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            if (interval >= 1) {
                return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
            }
        }
        return 'just now';
    }
    static getMinDate() {
        const today = new Date();
        return today.toISOString().split('T')[0];
    }
    static getMaxDate(daysAhead = 7) {
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + daysAhead);
        return maxDate.toISOString().split('T')[0];
    }
}
class LocationUtils {
    static calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;
        return Math.round(distance * 10) / 10; // Round to 1 decimal
    }
    static toRad(degrees) {
        return degrees * (Math.PI / 180);
    }
    static async getCurrentLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }
            navigator.geolocation.getCurrentPosition((position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                });
            }, (error) => {
                reject(error);
            });
        });
    }
}
// ─────────────────────────────────────────
// STORAGE UTILITIES
// ─────────────────────────────────────────
class StorageUtils {
    static save(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        }
        catch (e) {
            console.error('Storage error:', e);
            return false;
        }
    }
    static load(key) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        }
        catch (e) {
            console.error('Storage error:', e);
            return null;
        }
    }
    static remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        }
        catch (e) {
            console.error('Storage error:', e);
            return false;
        }
    }
    static clear() {
        try {
            localStorage.clear();
            return true;
        }
        catch (e) {
            console.error('Storage error:', e);
            return false;
        }
    }
}
class FileUtils {
    static async readAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => { var _a; return resolve((_a = e.target) === null || _a === void 0 ? void 0 : _a.result); };
            reader.onerror = (e) => reject(e);
            reader.readAsDataURL(file);
        });
    }
    static validateImage(file) {
        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        const maxSize = 5 * 1024 * 1024; // 5MB
        if (!validTypes.includes(file.type)) {
            return { valid: false, error: 'Invalid file type. Please upload an image.' };
        }
        if (file.size > maxSize) {
            return { valid: false, error: 'File too large. Maximum size is 5MB.' };
        }
        return { valid: true };
    }
    static formatFileSize(bytes) {
        if (bytes === 0)
            return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}
// ─────────────────────────────────────────
// ANIMATION UTILITIES
// ─────────────────────────────────────────
class AnimationUtils {
    static fadeIn(element, duration = 300) {
        element.style.opacity = '0';
        element.style.display = 'block';
        let start = null;
        const animate = (timestamp) => {
            if (!start)
                start = timestamp;
            const progress = timestamp - start;
            element.style.opacity = String(Math.min(progress / duration, 1));
            if (progress < duration) {
                requestAnimationFrame(animate);
            }
        };
        requestAnimationFrame(animate);
    }
    static fadeOut(element, duration = 300) {
        let start = null;
        const initialOpacity = parseFloat(getComputedStyle(element).opacity) || 1;
        const animate = (timestamp) => {
            if (!start)
                start = timestamp;
            const progress = timestamp - start;
            element.style.opacity = String(initialOpacity * (1 - progress / duration));
            if (progress < duration) {
                requestAnimationFrame(animate);
            }
            else {
                element.style.display = 'none';
            }
        };
        requestAnimationFrame(animate);
    }
    static slideDown(element, duration = 300) {
        element.style.overflow = 'hidden';
        element.style.display = 'block';
        const height = element.scrollHeight;
        element.style.height = '0px';
        let start = null;
        const animate = (timestamp) => {
            if (!start)
                start = timestamp;
            const progress = timestamp - start;
            element.style.height = String(Math.min(progress / duration * height, height)) + 'px';
            if (progress < duration) {
                requestAnimationFrame(animate);
            }
            else {
                element.style.height = '';
                element.style.overflow = '';
            }
        };
        requestAnimationFrame(animate);
    }
    static slideUp(element, duration = 300) {
        const height = element.scrollHeight;
        element.style.overflow = 'hidden';
        element.style.height = height + 'px';
        let start = null;
        const animate = (timestamp) => {
            if (!start)
                start = timestamp;
            const progress = timestamp - start;
            element.style.height = String(height * (1 - progress / duration)) + 'px';
            if (progress < duration) {
                requestAnimationFrame(animate);
            }
            else {
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
function debounce(func, wait) {
    let timeout = null;
    return function executedFunction(...args) {
        const later = () => {
            if (timeout)
                clearTimeout(timeout);
            func(...args);
        };
        if (timeout)
            clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
function throttle(func, limit) {
    let inThrottle = false;
    return function (...args) {
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
function ready(fn) {
    if (document.readyState !== 'loading') {
        fn();
    }
    else {
        document.addEventListener('DOMContentLoaded', fn);
    }
}
//# sourceMappingURL=components.js.map