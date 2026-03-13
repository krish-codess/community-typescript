/* ========================================
   COMMUNITY Feature - Main Application
   Updated to work with the new DHub login UI
   ======================================== */

// ─────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────

// Describes a logged-in user object
interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  created_at?: string;
}

// Describes a single notification item
interface AppNotification {
  title: string;
  message: string;
  time: string;
  unread: boolean;
}

// Describes a volunteer request card
interface VolunteerRequest {
  id: string;
  title: string;
  food_type: string;
  servings: number;
  location: string;
  distance: number;
  pickupWindow: string;
  urgent: boolean;
  useOwnContainer: boolean;
  donation_status: string;
  charity_name: string;
}

// Describes a single order timeline event
interface TimelineEvent {
  event: string;
  actor: string;
  timestamp: string;
  note?: string;
}

// Describes a full order object
interface DonationOrder {
  id: string;
  food_type: string;
  servings: number;
  status: string;
  host_name: string;
  volunteer_name: string;
  volunteer_phone?: string;
  charity_name: string;
  created_at: string;
  timeline: TimelineEvent[];
}

// ─────────────────────────────────────────
// COMMUNITYAPP CLASS
// ─────────────────────────────────────────

class CommunityApp {
  currentPage: string;
  user: User | null;
  notifications: AppNotification[];
  api: CommunityAPI;

  constructor() {
    this.currentPage = 'home';
    this.user = null;
    this.notifications = [];
    this.api = new CommunityAPI();
    this.init();
  }

  init(): void {
    const storedUser: string | null = localStorage.getItem('community_user');
    if (storedUser) {
      try { this.user = JSON.parse(storedUser); } catch (e) { this.user = null; }
    }
    this.updateUIForRole(this.user?.role || null);
    this.setupNavigation();
    this.setupCounters();
    this.setupIntersectionObserver();
    this.loadInitialData();
    this.setupEventListeners();
    this.setupLoginUI();

    // Show home page by default; login is only required for protected pages
    this.navigateTo('home');
  }

  // ─────────────────────────────────────────
  // LOGIN UI SETUP
  // ─────────────────────────────────────────

  setupLoginUI(): void {
    // Password toggle (eye icon)
    const pwToggle: HTMLElement | null = document.getElementById('loginPwToggle');
    const pwInput: HTMLInputElement | null = document.getElementById('loginPassword') as HTMLInputElement | null;
    if (pwToggle && pwInput) {
      pwToggle.addEventListener('click', () => {
        const isText: boolean = pwInput.type === 'text';
        pwInput.type = isText ? 'password' : 'text';
        pwToggle.innerHTML = isText
          ? `<svg id="eyeIconOpen" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
             </svg>`
          : `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
             </svg>`;
      });
    }

    // Google sign-in button
    const googleBtn: HTMLElement | null = document.getElementById('googleSignInBtn');
    if (googleBtn) {
      googleBtn.addEventListener('click', () => this.handleGoogleSignIn());
    }

    // Forgot password link
    document.querySelector('.lc-forgot')?.addEventListener('click', (e: Event) => {
      e.preventDefault();
      this.showToast('Password reset link sent to your email.', 'info');
    });
  }

  startTypingAnimation(): void {
    const el: HTMLElement | null = document.getElementById('loginTypedText');
    if (!el) return;
    const phrases: string[] = [
      ' one-stop food hub.',
      ' daily deals, delivered.',
      ' community marketplace.',
      ' favourite restaurants, found.'
    ];
    let phraseIdx: number = 0;
    let charIdx: number = 0;
    let deleting: boolean = false;

    const tick = () => {
      const current: string = phrases[phraseIdx];
      if (!deleting) {
        charIdx++;
        el.textContent = current.slice(0, charIdx);
        if (charIdx === current.length) {
          deleting = true;
          setTimeout(tick, 1800);
          return;
        }
      } else {
        charIdx--;
        el.textContent = current.slice(0, charIdx);
        if (charIdx === 0) {
          deleting = false;
          phraseIdx = (phraseIdx + 1) % phrases.length;
        }
      }
      setTimeout(tick, deleting ? 38 : 58);
    };
    tick();
  }

  async handleGoogleSignIn(): Promise<void> {
    this.showToast('Google Sign-In: connect your Firebase project to enable this.', 'info');
  }

  // ─────────────────────────────────────────
  // UI ROLE MANAGEMENT
  // ─────────────────────────────────────────

  updateUIForRole(role: string | null): void {
    const loginBtn: HTMLElement | null = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.style.display = role ? 'none' : 'block';

    document.querySelectorAll<HTMLElement>('[data-role-visible]').forEach((el: HTMLElement) => {
      const roles: string[] = (el.dataset.roleVisible || '').split(',');
      if (!role) {
        el.style.display = roles.includes('guest') ? '' : 'none';
      } else {
        el.style.display = roles.includes(role) ? '' : 'none';
      }
    });
  }

  // ─────────────────────────────────────────
  // NAVIGATION
  // ─────────────────────────────────────────

  setupNavigation(): void {
    document.querySelectorAll<HTMLAnchorElement>('.nav-link').forEach((link: HTMLAnchorElement) => {
      link.addEventListener('click', (e: Event) => {
        e.preventDefault();
        this.navigateTo(link.dataset.page || '');
      });
    });

    document.querySelectorAll<HTMLElement>('[data-action]').forEach((btn: HTMLElement) => {
      btn.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        const action: string | undefined = target.dataset.action;
        if (action === 'donate')    this.navigateTo('donate');
        if (action === 'volunteer') this.navigateTo('volunteer');
      });
    });

    document.querySelectorAll<HTMLButtonElement>('.btn-workflow').forEach((btn: HTMLButtonElement) => {
      btn.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        const role: string | undefined = target.dataset.role;
        if (role === 'host')      this.navigateTo('donate');
        if (role === 'volunteer') this.navigateTo('volunteer');
        if (role === 'charity')   this.navigateTo('charity');
      });
    });
  }

  navigateTo(page: string): void {
    const role: string | undefined = this.user?.role;

    const guestAllowed: string[] = ['home', 'login'];
    if (!role && !guestAllowed.includes(page)) {
      this.showToast('Please login first.', 'error');
      this.navigateTo('login');
      return;
    }

    const accessControl: Record<string, string[]> = {
      donate:    ['host', 'charity'],
      volunteer: ['volunteer'],
      charity:   ['charity'],
      dashboard: ['admin'],
      orders:    ['host', 'volunteer', 'charity', 'admin'],
      profile:   ['host', 'volunteer', 'charity', 'admin']
    };

    if (accessControl[page] && role && !accessControl[page].includes(role)) {
      this.showToast('Access denied for your role.', 'error');
      return;
    }

    document.querySelectorAll('.page').forEach((p: Element) => p.classList.remove('active'));

    const pageEl: HTMLElement | null = document.getElementById(`${page}Page`);
    if (!pageEl) { console.warn(`Page #${page}Page not found`); return; }
    pageEl.classList.add('active');

    document.querySelectorAll<HTMLAnchorElement>('.nav-link').forEach((link: HTMLAnchorElement) => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    this.currentPage = page;

    if (page === 'volunteer')  this.loadVolunteerRequests();
    if (page === 'charity')    this.loadCharityIncomingDeliveries();
    if (page === 'dashboard')  this.loadDashboardData();
    if (page === 'profile')    this.loadProfile();
    if (page === 'orders')     this.loadMyOrders();

    if (page === 'home' || page === 'dashboard') {
      if (this.user?.role === 'charity') this.loadCharityFeed();
      else this.loadInitialData();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─────────────────────────────────────────
  // EVENT LISTENERS
  // ─────────────────────────────────────────

  setupEventListeners(): void {
    // Switch between login / register sections
    document.getElementById('toRegister')?.addEventListener('click', (e: Event) => {
      e.preventDefault();
      const loginSection: HTMLElement | null = document.getElementById('loginSection');
      const registerSection: HTMLElement | null = document.getElementById('registerSection');
      if (loginSection) loginSection.style.display = 'none';
      if (registerSection) registerSection.style.display = 'block';
    });

    document.getElementById('toLogin')?.addEventListener('click', (e: Event) => {
      e.preventDefault();
      const registerSection: HTMLElement | null = document.getElementById('registerSection');
      const loginSection: HTMLElement | null = document.getElementById('loginSection');
      if (registerSection) registerSection.style.display = 'none';
      if (loginSection) loginSection.style.display = 'block';
    });

    // Login form submit
    const loginForm: HTMLElement | null = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
        await this.handleLoginSubmit();
      });
    }

    // Register form submit
    const registerForm: HTMLElement | null = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
        await this.handleRegisterSubmit();
      });
    }

    // Logout button
    const logoutBtn: HTMLElement | null = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('community_token');
        localStorage.removeItem('community_user');
        this.user = null;
        this.showToast('Logged out successfully', 'info');
        setTimeout(() => window.location.reload(), 800);
      });
    }

    // Nav "Get Started" button
    document.getElementById('loginBtn')?.addEventListener('click', () => this.navigateTo('login'));

    // Donation form
    const donationForm: HTMLFormElement | null = document.getElementById('donationForm') as HTMLFormElement | null;
    if (donationForm) {
      donationForm.addEventListener('submit', (e: Event) => {
        e.preventDefault();
        this.handleDonationSubmit(donationForm);
      });
    }

    // Quality modal form
    document.getElementById('qualityForm')?.addEventListener('submit', (e: Event) => {
      e.preventDefault();
      const modal: HTMLElement | null = document.getElementById('qualityModal');
      const requestId: string | undefined = modal?.dataset.requestId;
      this.handleQualitySubmit(e.target as HTMLFormElement, requestId);
    });

    // Modal close buttons
    document.querySelectorAll<HTMLElement>('[data-modal-close]').forEach((btn: HTMLElement) => {
      btn.addEventListener('click', () => {
        btn.closest('.modal')?.classList.remove('active');
      });
    });
  }

  // ─────────────────────────────────────────
  // AUTH HANDLERS
  // ─────────────────────────────────────────

  async handleLoginSubmit(): Promise<void> {
    const emailInput = document.getElementById('loginEmail') as HTMLInputElement | null;
    const passwordInput = document.getElementById('loginPassword') as HTMLInputElement | null;
    const btn = document.getElementById('loginSubmitBtn') as HTMLButtonElement | null;

    const email: string = emailInput?.value.trim() || '';
    const password: string = passwordInput?.value || '';

    if (!email || !password) {
      this.showToast('Please fill in all fields.', 'error');
      return;
    }

    if (btn) { btn.textContent = 'Signing in…'; btn.disabled = true; }

    try {
      const res = await this.api.login({ email, password });
      this.user = res.data.user as User;
      localStorage.setItem('community_user', JSON.stringify(this.user));
      this.updateUIForRole(this.user.role);
      this.showToast(`Welcome back, ${this.user.name || this.user.email}! 👋`, 'success');
      this.navigateTo('home');
    } catch (err: any) {
      this.showToast(err.message || 'Invalid credentials. Please try again.', 'error');
      // Shake the card for visual feedback
      const card: HTMLElement | null = document.getElementById('authCard');
      if (card) {
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 700);
      }
    } finally {
      if (btn) { btn.textContent = 'Sign In'; btn.disabled = false; }
    }
  }

  async handleRegisterSubmit(): Promise<void> {
    const nameInput = document.getElementById('regName') as HTMLInputElement | null;
    const emailInput = document.getElementById('regEmail') as HTMLInputElement | null;
    const roleInput = document.getElementById('regRole') as HTMLSelectElement | null;
    const passwordInput = document.getElementById('regPassword') as HTMLInputElement | null;
    const btn = document.getElementById('registerSubmitBtn') as HTMLButtonElement | null;

    const name: string = nameInput?.value.trim() || '';
    const email: string = emailInput?.value.trim() || '';
    const role: string = roleInput?.value || '';
    const password: string = passwordInput?.value || '';

    if (!name || !email || !role || !password) {
      this.showToast('Please fill in all fields.', 'error');
      return;
    }

    if (btn) { btn.textContent = 'Creating account…'; btn.disabled = true; }

    try {
      await this.api.register({ name, email, role, password });
      this.showToast('Account created! Please sign in.', 'success');
      const registerSection: HTMLElement | null = document.getElementById('registerSection');
      const loginSection: HTMLElement | null = document.getElementById('loginSection');
      if (registerSection) registerSection.style.display = 'none';
      if (loginSection) loginSection.style.display = 'block';
      if (emailInput) emailInput.value = email;
    } catch (err: any) {
      this.showToast(err.message || 'Registration failed. Please try again.', 'error');
    } finally {
      if (btn) { btn.textContent = 'Create Account'; btn.disabled = false; }
    }
  }

  // ─────────────────────────────────────────
  // COUNTERS & OBSERVERS
  // ─────────────────────────────────────────

  setupCounters(): void {
    document.querySelectorAll<HTMLElement>('[data-count]').forEach((counter: HTMLElement) => {
      const target: number = parseInt(counter.dataset.count || '0');
      const duration: number = 2000;
      const increment: number = target / (duration / 16);
      let current: number = 0;

      const updateCounter = () => {
        current += increment;
        if (current < target) {
          counter.textContent = String(Math.floor(current));
          requestAnimationFrame(updateCounter);
        } else {
          counter.textContent = String(target);
        }
      };

      const observer: IntersectionObserver = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
        entries.forEach((e: IntersectionObserverEntry) => {
          if (e.isIntersecting) { updateCounter(); observer.unobserve(e.target); }
        });
      });
      observer.observe(counter);
    });
  }

  setupIntersectionObserver(): void {
    const observer: IntersectionObserver = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        entries.forEach((e: IntersectionObserverEntry) => {
          if (e.isIntersecting) e.target.classList.add('visible');
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );
    document.querySelectorAll('.fade-in-up, .fade-in-left, .fade-in-right, .stagger-children')
      .forEach((el: Element) => observer.observe(el));
  }

  // ─────────────────────────────────────────
  // DONATION HANDLERS
  // ─────────────────────────────────────────

  async handleDonationSubmit(form: HTMLFormElement): Promise<void> {
    const validator: FormValidator = new FormValidator(form);
    validator.clearErrors();
    if (!validator.validate()) return;

    const submitBtn: HTMLButtonElement | null =
      form.querySelector('[type="submit"]') || form.querySelector('.btn-submit');
    if (submitBtn) { submitBtn.textContent = 'Submitting...'; submitBtn.disabled = true; }

    try {
      const formData: FormData = new FormData(form);
      const data: Record<string, any> = Object.fromEntries(Array.from(formData as any));
      data.useOwnContainer = !!formData.get('useOwnContainer');
      data.servings = parseInt(data.servings);
      await this.api.createDonation(data);
      this.showToast('Donation request submitted! Thank you for your generosity. 💚', 'success');
      form.reset();
      setTimeout(() => this.navigateTo('home'), 1500);
    } catch (error) {
      this.showToast('Failed to submit donation. Please try again.', 'error');
    } finally {
      if (submitBtn) { submitBtn.textContent = 'Submit Donation'; submitBtn.disabled = false; }
    }
  }

  async handleQualitySubmit(form: HTMLFormElement, requestId: string | undefined): Promise<void> {
    const validator: FormValidator = new FormValidator(form);
    validator.clearErrors();
    if (!validator.validate()) return;

    const formData: FormData = new FormData(form);
    const data: Record<string, any> = Object.fromEntries(Array.from(formData as any));

    try {
      await this.api.submitQualityAssessment({
        requestId: requestId || data.requestId,
        qualityRating: data.qualityRating,
        qualityNotes: data.qualityNotes,
        photos: []
      });
      this.showToast('Quality assessment submitted! ✓', 'success');
      document.getElementById('qualityModal')?.classList.remove('active');
      form.reset();
    } catch (err) {
      this.showToast('Failed to submit assessment.', 'error');
      console.error(err);
    }
  }

  handlePhotoUpload(files: FileList): void {
    const container: HTMLElement | null = document.getElementById('uploadedPhotos');
    if (!container) return;
    container.innerHTML = '';
    Array.from(files).forEach((file: File, index: number) => {
      const reader: FileReader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const photoDiv: HTMLDivElement = document.createElement('div');
        photoDiv.className = 'uploaded-photo';
        photoDiv.innerHTML = `
          <img src="${e.target?.result}" alt="Photo ${index + 1}">
          <button type="button" class="photo-remove" onclick="this.parentElement.remove()">×</button>
        `;
        container.appendChild(photoDiv);
      };
      reader.readAsDataURL(file);
    });
  }

  // ─────────────────────────────────────────
  // DATA LOADING
  // ─────────────────────────────────────────

  loadInitialData(): void { this.loadNotifications(); }

  loadNotifications(): void {
    this.notifications = [];
    this.renderNotifications();
  }

  renderNotifications(): void {
    const container: HTMLElement | null = document.getElementById('notificationList');
    if (!container) return;
    if (!this.notifications.length) {
      container.innerHTML = '<div class="notification-item"><div class="notification-message">No notifications yet.</div></div>';
    } else {
      container.innerHTML = this.notifications.map((n: AppNotification) => `
        <div class="notification-item ${n.unread ? 'unread' : ''}">
          <div class="notification-title">${n.title}</div>
          <div class="notification-message">${n.message}</div>
          <div class="notification-time">${n.time}</div>
        </div>
      `).join('');
    }
    const unreadCount: number = this.notifications.filter((n: AppNotification) => n.unread).length;
    const badge: HTMLElement | null = document.querySelector('.notification-badge');
    if (badge) { badge.textContent = String(unreadCount); badge.style.display = unreadCount > 0 ? 'flex' : 'none'; }
  }

  async loadVolunteerRequests(): Promise<void> {
    const container: HTMLElement | null = document.getElementById('requestsGrid');
    if (!container) return;
    container.innerHTML = '<div class="spinner"></div>';
    try {
      const res = await this.api.getAvailableRequests();
      const requests: VolunteerRequest[] = res.data.requests.map((r: any) => ({
        id: r.id, title: r.food_description, food_type: r.food_type,
        servings: r.servings, location: r.pickup_address,
        distance: r.distance_km || 0,
        pickupWindow: `${r.pickup_date}, ${r.pickup_time_start} – ${r.pickup_time_end}`,
        urgent: r.distance_km < 2, useOwnContainer: r.use_own_container,
        donation_status: r.donation_status, charity_name: r.charity_name
      }));
      this.renderVolunteerRequests(requests);
    } catch (error) {
      container.innerHTML = '<p>Could not load requests. Please try again later.</p>';
    }
  }

  renderVolunteerRequests(requests: VolunteerRequest[]): void {
    const container: HTMLElement | null = document.getElementById('requestsGrid');
    if (!container) return;
    if (!requests.length) {
      container.innerHTML = '<p class="text-center text-muted">No available requests right now.</p>';
      return;
    }
    container.innerHTML = requests.map((req: VolunteerRequest) => `
      <div class="request-card ${req.urgent ? 'urgent' : ''}" data-id="${req.id}">
        <div class="request-header">
          <div class="request-title">${req.title || req.food_type}</div>
          ${req.urgent   ? '<div class="request-badge urgent">Urgent</div>' : ''}
          ${req.distance < 3 ? '<div class="request-badge nearby">Nearby</div>' : ''}
        </div>
        <div class="request-details">
          <div class="request-detail"><span class="detail-icon">🍽️</span><span>${req.food_type} • ${req.servings} servings</span></div>
          <div class="request-detail"><span class="detail-icon">📍</span><span>${req.location} (${req.distance} km)</span></div>
          <div class="request-detail"><span class="detail-icon">⏰</span><span>${req.pickupWindow}</span></div>
          ${req.useOwnContainer ? '<div class="request-detail"><span class="detail-icon">♻️</span><span>Containers provided</span></div>' : ''}
          ${req.charity_name ? `<div class="request-detail"><span class="detail-icon">🏥</span><span>Going to: ${req.charity_name}</span></div>` : ''}
        </div>
        <div class="request-footer">
          <button class="btn-accept" onclick="app.acceptRequest('${req.id}')">Accept Pickup</button>
        </div>
      </div>
    `).join('');
  }

  async acceptRequest(requestId: string): Promise<void> {
    try {
      await this.api.acceptRequest(requestId);
      this.showToast('Pickup request accepted! 🚀', 'success');
      setTimeout(() => {
        const modal: HTMLElement | null = document.getElementById('qualityModal');
        if (modal) { modal.classList.add('active'); modal.dataset.requestId = requestId; }
      }, 1000);
      this.loadVolunteerRequests();
    } catch (error) {
      this.showToast('Failed to accept request.', 'error');
      console.error(error);
    }
  }

  async loadProfile(): Promise<void> {
    try {
      const response = await this.api.getProfile();
      if (!response.success) return;
      const user: any = response.data;

      const set = (id: string, val: string | undefined): void => {
        const el: HTMLElement | null = document.getElementById(id);
        if (el) el.textContent = val || '–';
      };

      const formattedDate: string = user.created_at
        ? new Date(user.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '–';

      // Identity card
      const initials: string = (user.name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
      const avatarEl: HTMLElement | null = document.getElementById('profileAvatar');
      if (avatarEl) avatarEl.textContent = initials;

      set('profileName',   user.name);
      set('profileEmail',  user.email);
      set('profilePhone',  user.phone);
      set('profileCreated', formattedDate);

      set('profileNameDetail',    user.name);
      set('profileEmailDetail',   user.email);
      set('profilePhoneDetail',   user.phone || '–');
      set('profileCreatedDetail', formattedDate);

      // Role badge
      const roleMap: Record<string, { icon: string; label: string; desc: string }> = {
        host:      { icon: '🏠', label: 'Food Host',    desc: 'You list surplus food and schedule pickups for volunteers to collect and deliver to charities.' },
        volunteer: { icon: '🚴', label: 'Volunteer',    desc: 'You pick up food from hosts, assess quality, and deliver it to registered charities in your area.' },
        charity:   { icon: '🏥', label: 'Charity / NGO', desc: 'You receive quality-verified food donations and distribute them to communities in need.' },
        admin:     { icon: '⚙️', label: 'Admin',        desc: 'You have full access to the community dashboard and platform management tools.' },
      };
      const roleInfo = roleMap[user.role] || { icon: '👤', label: user.role || 'Member', desc: '' };

      const badgeIcon  = document.getElementById('profileRoleIcon');
      const badgeLabel = document.getElementById('profileRoleLabel');
      const roleDetail = document.getElementById('profileRoleDetail');
      const infoIcon   = document.getElementById('profileRoleInfoIcon');
      const infoTitle  = document.getElementById('profileRoleInfoTitle');
      const infoDesc   = document.getElementById('profileRoleInfoDesc');

      if (badgeIcon)  badgeIcon.textContent  = roleInfo.icon;
      if (badgeLabel) badgeLabel.textContent  = roleInfo.label;
      if (roleDetail) roleDetail.textContent  = `${roleInfo.icon} ${roleInfo.label}`;
      if (infoIcon)   infoIcon.textContent    = roleInfo.icon;
      if (infoTitle)  infoTitle.textContent   = roleInfo.label;
      if (infoDesc)   infoDesc.textContent    = roleInfo.desc;

      // Stats
      try {
        const statsApi = this.api as any;
        const stats = await statsApi.getUserStats?.();
        set('profileMealsCount',     stats?.data?.meals     ?? '—');
        set('profileDonationsCount', stats?.data?.donations ?? '—');
        set('profileCO2Count',       stats?.data?.co2       ?? '—');
      } catch (_) {
        set('profileMealsCount',     '—');
        set('profileDonationsCount', '—');
        set('profileCO2Count',       '—');
      }

    } catch (error) {
      console.error('Failed to load profile:', error);
    }
  }

  async loadCharityIncomingDeliveries(): Promise<void> {
    const container: HTMLElement | null = document.getElementById('deliveriesList');
    if (!container) return;
    container.innerHTML = '<p>Loading incoming food...</p>';
    try {
      const response = await this.api.getCharityDeliveries();
      const deliveries: any[] = response.data?.deliveries ?? response.data ?? [];
      if (!deliveries.length) {
        container.innerHTML = '<div class="empty-state"><p>No incoming deliveries right now.</p></div>';
        return;
      }
      container.innerHTML = deliveries.map((item: any) => `
        <div class="delivery-card">
          <div class="delivery-header">
            <span class="status-badge ${item.status}">${item.status.replace(/_/g, ' ')}</span>
            <h3>${item.food_type}</h3>
          </div>
          <div class="delivery-body">
            <p><strong>Servings:</strong> ${item.servings}</p>
            <p><strong>Volunteer:</strong> ${item.volunteer_name || 'Assigned'}</p>
            ${item.volunteer_phone ? `<p><strong>Phone:</strong> ${item.volunteer_phone}</p>` : ''}
            ${item.quality_rating  ? `<p><strong>Quality:</strong> ${item.quality_rating}</p>` : ''}
            ${item.quality_notes   ? `<p><strong>Notes:</strong> ${item.quality_notes}</p>` : ''}
          </div>
          ${item.status === 'awaiting_charity' ? `<button class="btn-primary full-width mt-sm" onclick="app.acceptDelivery('${item.id}')">Accept Delivery</button>` : ''}
          ${item.status === 'in_transit'       ? `<button class="btn-success full-width mt-sm"  onclick="app.confirmReceipt('${item.id}')">Confirm Receipt</button>` : ''}
        </div>
      `).join('');
    } catch (err) {
      container.innerHTML = '<p class="error">Failed to load deliveries.</p>';
      console.error(err);
    }
  }

  async acceptDelivery(donationId: string): Promise<void> {
    try {
      await this.api.acceptByCharity(donationId);
      this.showToast('Delivery accepted. Volunteer is on the way!', 'success');
      this.loadCharityIncomingDeliveries();
    } catch (err) {
      this.showToast('Failed to accept delivery.', 'error');
      console.error(err);
    }
  }

  async confirmReceipt(donationId: string): Promise<void> {
    if (!confirm('Has this food been successfully delivered and inspected?')) return;
    try {
      const response = await this.api.updateDonationStatus(donationId, 'delivered');
      if (response.success) {
        this.showToast('Donation marked as delivered!', 'success');
        this.loadCharityIncomingDeliveries();
        this.loadDashboardData();
      }
    } catch (err) {
      this.showToast('Could not confirm receipt.', 'error');
      console.error(err);
    }
  }

  async loadDashboardData(): Promise<void> {
    try {
      const res = await this.api.getDashboardStats();
      const data: any = res.data;
      const statPairs: [string, any][] = [
        ['totalDonations',   data.totalDonations],
        ['totalServings',    data.totalServings],
        ['activeVolunteers', data.activeVolunteers],
        ['co2Reduced',       data.co2Reduced]
      ];
      statPairs.forEach(([id, val]) => {
        const el: HTMLElement | null = document.getElementById(id);
        if (el) el.textContent = val?.toLocaleString() || '0';
      });
    } catch (err) {
      console.warn('Dashboard stats could not be loaded:', err);
    }
    this.loadActivityFeed();
    this.loadLeaderboard();
  }

  loadActivityFeed(): void {
    const c: HTMLElement | null = document.getElementById('activityFeed');
    if (c) c.innerHTML = '<p>No recent activity.</p>';
  }

  loadLeaderboard(): void {
    const c: HTMLElement | null = document.getElementById('leaderboard');
    if (c) c.innerHTML = '<p>No data available.</p>';
  }

  async loadVolunteerFeed(): Promise<void> {
    const feedContainer: HTMLElement | null = document.getElementById('availableDonationsList');
    if (!feedContainer) return;
    feedContainer.innerHTML = '<div class="loading">Finding food to rescue...</div>';
    try {
      const response = await this.api.getAvailableDonations();
      const donations: any[] = response.data;
      if (!donations?.length) {
        feedContainer.innerHTML = '<p class="text-center">No donations available right now.</p>';
        return;
      }
      feedContainer.innerHTML = donations.map((item: any) => `
        <div class="donation-card fade-in">
          <div class="card-header">
            <h3>${item.food_type}</h3>
            <span class="badge">${item.servings} Servings</span>
          </div>
          <p><strong>Pickup:</strong> ${item.pickup_address}</p>
          <button class="btn-primary full-width mt-sm" onclick="app.handlePickup('${item.id}')">Accept Delivery Task</button>
          <p><strong>Destination:</strong> ${item.charity_name || 'Awaiting charity confirmation'}</p>
          <p><strong>Status:</strong> ${item.status.replace(/_/g, ' ')}</p>
        </div>
      `).join('');
    } catch (err) {
      feedContainer.innerHTML = '<p class="error">Error loading feed.</p>';
    }
  }

  async handlePickup(id: string): Promise<void> {
    try {
      await this.api.acceptPickup(id);
      this.showToast('Pickup confirmed! Check your active tasks.', 'success');
      this.loadVolunteerFeed();
    } catch (err) {
      this.showToast('Could not accept pickup.', 'error');
    }
  }

  async loadCharityFeed(): Promise<void> {
    const container: HTMLElement | null = document.getElementById('deliveriesList');
    if (!container) return;
    try {
      const response = await this.api.getCharityDeliveries();
      const deliveries: any[] = response.data?.deliveries ?? response.data ?? [];
      const stats: any = response.data?.stats || {};
      const set = (id: string, val: any): void => {
        const el: HTMLElement | null = document.getElementById(id);
        if (el) el.textContent = val || 0;
      };
      set('pendingDeliveries', stats.pendingDeliveries);
      set('receivedThisWeek',  stats.receivedThisWeek);
      set('totalServings',     stats.totalServings);
      if (!deliveries.length) {
        container.innerHTML = '<p class="text-muted">No incoming deliveries at the moment.</p>';
        return;
      }
      container.innerHTML = deliveries.map((item: any) => `
        <div class="delivery-card">
          <div class="delivery-info">
            <span class="status-tag ${item.status}">${item.status.replace(/_/g, ' ')}</span>
            <h3>${item.food_type}</h3>
            <p><strong>Volunteer:</strong> ${item.volunteer_name || 'Assigned'}</p>
          </div>
          <button class="btn-outline-primary" onclick="app.confirmReceipt('${item.id}')">Confirm Receipt</button>
        </div>
      `).join('');
    } catch (err) { console.error('Charity feed error:', err); }
  }

  // ─────────────────────────────────────────
  // ORDER TRANSPARENCY
  // ─────────────────────────────────────────

  async loadMyOrders(): Promise<void> {
    const container: HTMLElement | null = document.getElementById('ordersContainer');
    if (!container) return;
    container.innerHTML = '<div class="spinner"></div>';
    try {
      const res = await this.api.getMyOrders();
      const orders: DonationOrder[] = res.data?.orders ?? [];
      if (!orders.length) {
        container.innerHTML = '<div class="empty-state"><p>No orders yet. Your donations and deliveries will appear here with a full audit trail.</p></div>';
        return;
      }
      container.innerHTML = orders.map((o: DonationOrder) => this.renderOrderCard(o)).join('');
    } catch (err) {
      container.innerHTML = '<p class="error">Could not load orders.</p>';
      console.error(err);
    }
  }

  renderOrderCard(order: DonationOrder): string {
    const statusColors: Record<string, string> = {
      pending: '#f59e0b', available: '#3b82f6', awaiting_charity: '#8b5cf6',
      in_transit: '#f97316', delivered: '#10b981', cancelled: '#ef4444'
    };
    const actorIcons: Record<string, string> = { host: '🏠', volunteer: '🚴', charity: '🏥', system: '⚙️' };
    const color: string = statusColors[order.status] || '#6b7280';
    const timeline: TimelineEvent[] = order.timeline || [];

    const steps: { key: string; label: string; icon: string }[] = [
      { key: 'created',   label: 'Created',       icon: '📝' },
      { key: 'volunteer', label: 'Volunteer',      icon: '🚴' },
      { key: 'quality',   label: 'Quality Check',  icon: '✅' },
      { key: 'transit',   label: 'In Transit',     icon: '🚚' },
      { key: 'delivered', label: 'Delivered',      icon: '🎉' }
    ];

    const eventToStep = (ev: string): string | null => {
      const e: string = ev.toLowerCase();
      if (e.includes('creat'))   return 'created';
      if (e.includes('volunt') || e.includes('assign') || e.includes('accept')) return 'volunteer';
      if (e.includes('quality') || e.includes('assess')) return 'quality';
      if (e.includes('transit')) return 'transit';
      if (e.includes('deliver')) return 'delivered';
      return null;
    };

    const done: Set<string> = new Set(timeline.map((t: TimelineEvent) => eventToStep(t.event)).filter((x): x is string => x !== null));
    const keys: string[] = steps.map((s) => s.key);
    const lastDoneIdx: number = keys.reduce((acc: number, k: string, i: number) => done.has(k) ? i : acc, -1);

    const progressHTML: string = steps.map((step, i) => {
      const isDone: boolean = done.has(step.key);
      const isCurrent: boolean = i === lastDoneIdx + 1 && i < steps.length;
      return `
        <div class="order-step ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}">
          <div class="step-icon">${step.icon}</div>
          <div class="step-label">${step.label}</div>
        </div>
        ${i < steps.length - 1 ? `<div class="step-connector ${isDone && done.has(steps[i + 1]?.key) ? 'done' : ''}"></div>` : ''}
      `;
    }).join('');

    const timelineHTML: string = timeline.map((ev: TimelineEvent) => `
      <div class="timeline-event">
        <div class="timeline-dot ${ev.actor}"></div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-actor">${actorIcons[ev.actor] || '•'} ${ev.actor}</span>
            <span class="timeline-time">${DateTimeUtils.timeAgo(ev.timestamp)}</span>
          </div>
          <div class="timeline-event-name"><strong>${ev.event}</strong></div>
          ${ev.note ? `<div class="timeline-note">${ev.note}</div>` : ''}
        </div>
      </div>
    `).join('');

    return `
    <div class="order-card">
      <div class="order-card-header">
        <div class="order-meta">
          <h3 class="order-food-type">${order.food_type}</h3>
          <span class="order-servings">${order.servings} servings</span>
        </div>
        <span class="order-status-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">
          ${order.status.replace(/_/g, ' ')}
        </span>
      </div>
      <div class="order-parties">
        <div class="party-pill">🏠 <span>${order.host_name || 'Host'}</span></div>
        <div class="party-arrow">→</div>
        <div class="party-pill ${order.volunteer_name ? '' : 'empty'}">
          🚴 <span>${order.volunteer_name || 'Awaiting volunteer'}</span>
        </div>
        <div class="party-arrow">→</div>
        <div class="party-pill ${order.charity_name ? '' : 'empty'}">
          🏥 <span>${order.charity_name || 'Awaiting charity'}</span>
        </div>
      </div>
      <div class="order-progress">${progressHTML}</div>
      ${timeline.length ? `
      <details class="order-timeline-details">
        <summary>📋 Full audit trail (${timeline.length} events)</summary>
        <div class="order-timeline">${timelineHTML}</div>
      </details>` : ''}
      <div class="order-footer">
        <span class="order-id">ID: ${order.id}</span>
        <button class="btn-sm btn-outline" onclick="app.refreshOrderTimeline('${order.id}')">🔄 Refresh</button>
      </div>
    </div>`;
  }

  async refreshOrderTimeline(donationId: string): Promise<void> {
    try {
      const res = await this.api.getDonationTimeline(donationId);
      this.showToast(`Timeline refreshed — ${res.data?.timeline?.length ?? 0} events`, 'info');
      this.loadMyOrders();
    } catch (err) {
      this.showToast('Could not refresh timeline.', 'error');
    }
  }

  // ─────────────────────────────────────────
  // TOAST NOTIFICATIONS
  // ─────────────────────────────────────────

  showToast(message: string, type: string = 'info'): void {
    const toastContainer: HTMLElement | null = document.getElementById('toastContainer');
    if (!toastContainer) return;
    const icons: Record<string, string> = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
    const toast: HTMLDivElement = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-message">${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}

// ─────────────────────────────────────────
// APP ENTRY POINT
// The 'app' variable is global so that
// inline onclick handlers in HTML can call
// app.acceptRequest(), app.confirmReceipt(), etc.
// ─────────────────────────────────────────
let app: CommunityApp;
document.addEventListener('DOMContentLoaded', () => { app = new CommunityApp(); });
