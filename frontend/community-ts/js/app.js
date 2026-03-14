/* ========================================
   COMMUNITY — Main Application Controller
   Feature Pack v2

   New / changed sections:
   ─ initSocket()                  Feature 8  (real-time updates)
   ─ handleDonationSubmit()        Feature 3  (expiryTime, pickupLat/Lng)
   ─ loadAvailablePickups()        Feature 2  (nearby badge + distance)
   ─ volunteerDeclinePickup()      Feature 6  (reason prompt)
   ─ renderVolunteerDeliveryCard() Feature 1+3 (photo upload, countdown)
   ─ volunteerUpdateStatus()       Feature 1  (photo url)
   ─ renderCharityRequestCard()    Feature 1  (photo upload on confirm)
   ─ charityConfirmReceipt()       Feature 1  (sends photoUrl)
   ─ renderOrderCard()             Feature 1  (shows proof images in timeline)
   ─ loadLeaderboard()             Feature 5  (leaderboard)
   ─ renderLeaderboard()           Feature 5
   ─ loadWishlistForHosts()        Feature 7  (host sees charity needs)
   ─ loadCharityWishlist()         Feature 7  (charity manages wishlist)
   ─ loadStaleRequests()           Feature 10 (admin panel)
   ─ startExpiryTimers()           Feature 3  (countdown timers)
   ======================================== */

class CommunityApp {
    constructor() {
        this.user          = null;
        this.currentPage   = 'home';
        this.notifications = [];
        this.api           = new CommunityAPI();
        this._expiryTimers = new Map();   // Feature 3: keyed by donation ID
        this._socket       = null;        // Feature 8
        this.init();
    }

    init() {
        const stored = localStorage.getItem('community_user');
        if (stored) {
            try { this.user = JSON.parse(stored); } catch { this.user = null; }
        }
        this.updateUIForRole(this.user?.role || null);
        this.setupNavigation();
        this.setupCounters();
        this.setupIntersectionObserver();
        this.setupEventListeners();
        this.setupLoginUI();
        this.initSocket();          // Feature 8
        this.navigateTo('home');
    }

    // ─────────────────────────────────────────
    // FEATURE 8 · REAL-TIME SOCKET.IO
    // ─────────────────────────────────────────

    initSocket() {
        if (typeof io === 'undefined') {
            console.warn('socket.io not loaded — real-time updates disabled');
            return;
        }
        this._socket = io();

        this._socket.on('connect', () => {
            console.log('🔌 Real-time updates connected');
        });

        /**
         * Server emits { id, status, actor } whenever any request changes.
         * We refresh whichever dashboard section is currently visible.
         */
        this._socket.on('request_updated', ({ id, status, actor }) => {
            console.log(`🔔 request_updated: ${id} → ${status} (by ${actor})`);
            this.showToast(`A donation request was updated to: ${STATUS_LABELS[status] || status}`, 'info');

            // Silently refresh the current page's data feed
            if (this.currentPage === 'volunteer') this.loadVolunteerDashboard();
            if (this.currentPage === 'charity')   this.loadCharityDashboard();
            if (this.currentPage === 'donate')    this.loadHostDashboard();
            if (this.currentPage === 'orders')    this.loadMyOrders();
            if (this.currentPage === 'dashboard') this.loadDashboardData();
        });
    }

    // ─────────────────────────────────────────
    // LOGIN UI
    // ─────────────────────────────────────────

    setupLoginUI() {
        const pwToggle = document.getElementById('loginPwToggle');
        const pwInput  = document.getElementById('loginPassword');
        if (pwToggle && pwInput) {
            pwToggle.addEventListener('click', () => {
                const isText = pwInput.type === 'text';
                pwInput.type = isText ? 'password' : 'text';
                pwToggle.innerHTML = isText
                    ? `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                         <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                         <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                       </svg>`
                    : `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                         <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
                       </svg>`;
            });
        }
        document.getElementById('googleSignInBtn')?.addEventListener('click', () =>
            this.showToast('Google Sign-In: connect your Firebase project to enable this.', 'info'));
        document.querySelector('.lc-forgot')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showToast('Password reset link sent to your email.', 'info');
        });
    }

    // ─────────────────────────────────────────
    // ROLE UI
    // ─────────────────────────────────────────

    updateUIForRole(role) {
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn) loginBtn.style.display = role ? 'none' : 'block';

        document.querySelectorAll('[data-role-visible]').forEach((el) => {
            const roles = (el.dataset.roleVisible || '').split(',');
            el.style.display = (!role)
                ? (roles.includes('guest') ? '' : 'none')
                : (roles.includes(role)    ? '' : 'none');
        });
    }

    // ─────────────────────────────────────────
    // NAVIGATION
    // ─────────────────────────────────────────

    setupNavigation() {
        document.querySelectorAll('.nav-link').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo(link.dataset.page || '');
            });
        });
        document.querySelectorAll('[data-action]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                if (action === 'donate')    this.navigateTo('donate');
                if (action === 'volunteer') this.navigateTo('volunteer');
            });
        });
        document.querySelectorAll('.btn-workflow').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const role = e.target.dataset.role;
                if (role === 'host')      this.navigateTo('donate');
                if (role === 'volunteer') this.navigateTo('volunteer');
                if (role === 'charity')   this.navigateTo('charity');
            });
        });
    }

    navigateTo(page) {
        const role        = this.user?.role;
        const guestAllowed = ['home', 'login'];

        if (!role && !guestAllowed.includes(page)) {
            this.showToast('Please login first.', 'error');
            this.navigateTo('login');
            return;
        }

        const accessControl = {
            donate:     ['host'],
            volunteer:  ['volunteer'],
            charity:    ['charity'],
            dashboard:  ['admin'],
            orders:     ['host', 'volunteer', 'charity', 'admin'],
            profile:    ['host', 'volunteer', 'charity', 'admin'],
            leaderboard: ['host', 'volunteer', 'charity', 'admin'],
            wishlist:   ['host', 'charity', 'admin'],
            stale:      ['admin']
        };

        if (accessControl[page] && role && !accessControl[page].includes(role)) {
            this.showToast('Access denied for your role.', 'error');
            return;
        }

        document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
        const pageEl = document.getElementById(`${page}Page`);
        if (!pageEl) { console.warn(`#${page}Page not found`); return; }

        pageEl.classList.add('active');
        document.querySelectorAll('.nav-link').forEach((l) =>
            l.classList.toggle('active', l.dataset.page === page));
        this.currentPage = page;

        if (page === 'donate')       this.loadHostDashboard();
        if (page === 'volunteer')    this.loadVolunteerDashboard();
        if (page === 'charity') {
            this.loadCharityDashboard();
        }
        if (page === 'dashboard')    this.loadDashboardData();
        if (page === 'profile')      this.loadProfile();
        if (page === 'orders')       this.loadMyOrders();
        if (page === 'home')         {
            if (this.api.isLoggedIn()) { this.loadDashboardData(); this.loadLeaderboard(); }
        }
        if (page === 'leaderboard')  this.loadLeaderboard();
        if (page === 'wishlist')     {
            if (role === 'charity')    this.loadCharityWishlist();
            else                       this.loadWishlistForHosts();
        }
        if (page === 'stale')        this.loadStaleRequests();

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ─────────────────────────────────────────
    // EVENT LISTENERS
    // ─────────────────────────────────────────

    setupEventListeners() {
        document.getElementById('toRegister')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('loginSection').style.display    = 'none';
            document.getElementById('registerSection').style.display = 'block';
        });
        document.getElementById('toLogin')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('registerSection').style.display = 'none';
            document.getElementById('loginSection').style.display    = 'block';
        });
        document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
            e.preventDefault(); await this.handleLoginSubmit();
        });
        document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
            e.preventDefault(); await this.handleRegisterSubmit();
        });
        document.getElementById('logoutBtn')?.addEventListener('click', () => {
            this.api.logout();
            this.user = null;
            this.updateUIForRole(null);
            this.showToast('Logged out.', 'info');
            setTimeout(() => this.navigateTo('login'), 800);
        });
        document.getElementById('loginBtn')?.addEventListener('click', () => this.navigateTo('login'));
        document.getElementById('donationForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleDonationSubmit(e.target);
        });
        document.querySelectorAll('[data-modal-close]').forEach((btn) => {
            btn.addEventListener('click', () => btn.closest('.modal')?.classList.remove('active'));
        });

        // Feature 7: wishlist add form
        document.getElementById('wishlistForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleWishlistSubmit(e.target);
        });
    }

    // ─────────────────────────────────────────
    // AUTH
    // ─────────────────────────────────────────

    async handleLoginSubmit() {
        const email    = document.getElementById('loginEmail')?.value.trim()   || '';
        const password = document.getElementById('loginPassword')?.value        || '';
        const btn      = document.getElementById('loginSubmitBtn');

        if (!email || !password) { this.showToast('Please fill in all fields.', 'error'); return; }
        if (btn) { btn.textContent = 'Signing in…'; btn.disabled = true; }
        try {
            const res  = await this.api.login({ email, password });
            this.user  = res.data.user;
            localStorage.setItem('community_user', JSON.stringify(this.user));
            this.updateUIForRole(this.user.role);
            this.showToast(`Welcome back, ${this.user.name}! 👋`, 'success');
            this.navigateTo('home');
        } catch (err) {
            this.showToast(err.message || 'Invalid credentials.', 'error');
            const card = document.getElementById('authCard');
            if (card) { card.classList.add('shake'); setTimeout(() => card.classList.remove('shake'), 700); }
        } finally {
            if (btn) { btn.textContent = 'Sign In'; btn.disabled = false; }
        }
    }

    async handleRegisterSubmit() {
        const name     = document.getElementById('regName')?.value.trim()  || '';
        const email    = document.getElementById('regEmail')?.value.trim() || '';
        const role     = document.getElementById('regRole')?.value          || '';
        const password = document.getElementById('regPassword')?.value      || '';
        const btn      = document.getElementById('registerSubmitBtn');

        if (!name || !email || !role || !password) {
            this.showToast('Please fill in all fields.', 'error'); return;
        }
        if (btn) { btn.textContent = 'Creating account…'; btn.disabled = true; }
        try {
            await this.api.register({ name, email, role, password });
            this.showToast('Account created! Please sign in.', 'success');
            document.getElementById('registerSection').style.display = 'none';
            document.getElementById('loginSection').style.display    = 'block';
            document.getElementById('loginEmail').value = email;
        } catch (err) {
            this.showToast(err.message || 'Registration failed.', 'error');
        } finally {
            if (btn) { btn.textContent = 'Create Account'; btn.disabled = false; }
        }
    }

    // ─────────────────────────────────────────
    // HOST DASHBOARD
    // ─────────────────────────────────────────

    async loadHostDashboard() {
        await Promise.all([
            this.loadMyDonations(),
            this.loadWishlistForHosts()  // Feature 7
        ]);
    }

    /**
     * FEATURE 3: reads expiryTime from form.
     * FEATURE 2: reads pickupLat / pickupLng if provided.
     */
    async handleDonationSubmit(form) {
        const validator = new FormValidator(form);
        validator.clearErrors();
        if (!validator.validate()) return;

        const btn = form.querySelector('[type="submit"]') || form.querySelector('.btn-submit');
        if (btn) { btn.textContent = 'Submitting…'; btn.disabled = true; }

        try {
            const fd = new FormData(form);
            const foodType        = fd.get('foodType')        || '';
            const foodDescription = fd.get('foodDescription') || '';
            const servings        = fd.get('servings')        || '';
            const pickupDate      = fd.get('pickupDate')      || '';
            const pickupTimeStart = fd.get('pickupTimeStart') || '';
            const pickupTimeEnd   = fd.get('pickupTimeEnd')   || '';

            await this.api.createDonation({
                foodDescription:     foodType + (foodDescription ? ` — ${foodDescription}` : ''),
                quantity:            servings ? `${servings} servings` : 'Unspecified',
                pickupAddress:       fd.get('pickupAddress')  || '',
                contactPhone:        fd.get('contactPhone')   || '',
                preferredPickupTime: pickupDate
                    ? `${pickupDate}${pickupTimeStart ? ', ' + pickupTimeStart : ''}${pickupTimeEnd ? ' – ' + pickupTimeEnd : ''}`
                    : '',
                notes:       fd.get('specialInstructions') || fd.get('notes') || '',
                expiryTime:  fd.get('expiryTime')  || null,     // Feature 3
                pickupLat:   fd.get('pickupLat')   || null,     // Feature 2
                pickupLng:   fd.get('pickupLng')   || null      // Feature 2
            });
            this.showToast('Donation request submitted! Charities can now see it. 💚', 'success');
            form.reset();
            await this.loadMyDonations();
        } catch (err) {
            this.showToast('Failed to submit donation. Please try again.', 'error');
        } finally {
            if (btn) { btn.textContent = 'Submit Donation'; btn.disabled = false; }
        }
    }

    async loadMyDonations() {
        const container = document.getElementById('myDonationsList') || document.getElementById('donationsContainer');
        if (!container) return;
        container.innerHTML = '<div class="spinner"></div>';
        try {
            const res  = await this.api.getMyDonations();
            const list = res.data.donations || [];
            if (!list.length) {
                container.innerHTML = '<div class="empty-state"><p>No donation requests yet. Create your first one above!</p></div>';
                return;
            }
            container.innerHTML = list.map((d) => this.renderDonationCard(d)).join('');
        } catch {
            container.innerHTML = '<p class="error">Could not load your donations.</p>';
        }
    }

    renderDonationCard(d) {
        const label     = STATUS_LABELS[d.status] || d.status;
        const color     = STATUS_COLORS[d.status] || '#6b7280';
        const countdown = d.expiry_time ? this.renderExpiryBadge(d.id, d.expiry_time) : '';   // Feature 3

        return `
        <div class="donation-card" data-id="${d.id}">
          <div class="donation-header">
            <div>
              <h3>${d.food_description}</h3>
              <p class="text-muted">${d.quantity} · ${d.pickup_address}</p>
            </div>
            <span class="status-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${label}</span>
          </div>
          ${countdown}
          ${d.charity_name   ? `<p>🏥 <strong>Charity:</strong> ${d.charity_name}</p>` : ''}
          ${d.volunteer_name ? `<p>🚴 <strong>Volunteer:</strong> ${d.volunteer_name} ${d.volunteer_phone ? '· ' + d.volunteer_phone : ''}</p>` : ''}
          <p class="donation-meta">ID: ${d.id} · ${DateTimeUtils.timeAgo(d.created_at)}</p>
          ${d.receipt_path && d.status === 'COMPLETED'
              ? `<a class="btn-sm btn-outline" href="${this.api.getReceiptUrl(d.id)}" target="_blank">📄 Download Receipt</a>`
              : ''}
        </div>`;
    }

    // ─────────────────────────────────────────
    // FEATURE 3 · EXPIRY COUNTDOWN
    // ─────────────────────────────────────────

    /**
     * Returns the HTML for a countdown badge and registers a timer
     * that updates it every second.  Call `this.clearExpiryTimers()` when
     * the container is about to be replaced to avoid ghost intervals.
     */
    renderExpiryBadge(id, expiryTime) {
        const el_id = `expiry-${id}`;
        // Schedule the live update (deferred so the element exists in DOM)
        setTimeout(() => this._startCountdown(el_id, new Date(expiryTime)), 50);
        return `<div class="expiry-badge" id="${el_id}">⏳ Calculating…</div>`;
    }

    _startCountdown(el_id, expiryDate) {
        const update = () => {
            const el   = document.getElementById(el_id);
            if (!el) { clearInterval(timer); this._expiryTimers.delete(el_id); return; }

            const msLeft = expiryDate - Date.now();
            if (msLeft <= 0) {
                el.textContent = '⚠️ Expired';
                el.style.color = '#ef4444';
                clearInterval(timer);
                this._expiryTimers.delete(el_id);
                return;
            }

            const h = Math.floor(msLeft / 3_600_000);
            const m = Math.floor((msLeft % 3_600_000) / 60_000);
            const s = Math.floor((msLeft % 60_000) / 1_000);
            const urgent = msLeft < 30 * 60_000;  // < 30 min → red

            el.textContent      = `⏳ Expires in: ${h}h ${m}m ${s}s`;
            el.style.color      = urgent ? '#ef4444' : '#f59e0b';
            el.style.fontWeight = urgent ? '700' : '500';
        };

        // Clear any existing timer for the same element
        if (this._expiryTimers.has(el_id)) {
            clearInterval(this._expiryTimers.get(el_id));
        }
        update();
        const timer = setInterval(update, 1_000);
        this._expiryTimers.set(el_id, timer);
    }

    clearExpiryTimers() {
        this._expiryTimers.forEach(clearInterval);
        this._expiryTimers.clear();
    }

    // ─────────────────────────────────────────
    // CHARITY DASHBOARD
    // ─────────────────────────────────────────

    async loadCharityDashboard() {
        await Promise.all([
            this.loadAvailableRequests(),
            this.loadCharityMyRequests()
        ]);
    }

    async loadAvailableRequests() {
        const container = document.getElementById('charityOrdersList')
                       || document.getElementById('availableRequestsGrid')
                       || document.getElementById('requestsGrid');
        if (!container) return;
        container.innerHTML = '<div class="spinner"></div>';
        try {
            const res  = await this.api.getAvailableRequests();
            const list = res.data.requests || [];
            if (!list.length) {
                container.innerHTML = '<p class="text-center text-muted">No open donation requests right now. Check back soon!</p>';
                return;
            }
            container.innerHTML = list.map((r) => `
            <div class="request-card" data-id="${r.id}">
              <div class="request-header">
                <h3>${r.food_description}</h3>
                <span class="badge badge-blue">Available</span>
              </div>
              <div class="request-details">
                <div class="request-detail"><span>🍽️</span> ${r.quantity}</div>
                <div class="request-detail"><span>📍</span> ${r.pickup_address}</div>
                ${r.preferred_pickup_time ? `<div class="request-detail"><span>⏰</span> ${r.preferred_pickup_time}</div>` : ''}
                ${r.contact_phone ? `<div class="request-detail"><span>📞</span> ${r.contact_phone}</div>` : ''}
                <div class="request-detail"><span>🏠</span> Host: ${r.host_name}</div>
              </div>
              ${r.expiry_time ? this.renderExpiryBadge(r.id + '-ch', r.expiry_time) : ''}
              ${r.notes ? `<p class="request-notes">${r.notes}</p>` : ''}
              <div class="request-footer">
                <button class="btn-accept" onclick="app.charityAcceptRequest('${r.id}', this)">
                  ✓ Accept Request
                </button>
              </div>
            </div>`).join('');
        } catch {
            container.innerHTML = '<p class="error">Could not load available requests.</p>';
        }
    }

    async charityAcceptRequest(id, btn) {
        if (btn) { btn.textContent = 'Accepting…'; btn.disabled = true; }
        try {
            await this.api.acceptRequest(id);
            this.showToast('Request accepted! Now find a volunteer to pick it up.', 'success');
            await this.loadCharityDashboard();
        } catch (err) {
            this.showToast(err.message || 'Could not accept request.', 'error');
            if (btn) { btn.textContent = '✓ Accept Request'; btn.disabled = false; }
        }
    }

    async loadCharityMyRequests() {
        const container = document.getElementById('deliveriesList') || document.getElementById('charityMyRequests');
        if (!container) return;
        container.innerHTML = '<div class="spinner"></div>';
        try {
            const res  = await this.api.getCharityRequests();
            const list = res.data.requests || [];
            if (!list.length) {
                container.innerHTML = '<div class="empty-state"><p>No accepted requests yet.</p></div>';
                return;
            }
            container.innerHTML = list.map((r) => this.renderCharityRequestCard(r)).join('');
        } catch {
            container.innerHTML = '<p class="error">Could not load your requests.</p>';
        }
    }

    /**
     * FEATURE 1: Shows a photo URL input when status is FOOD_PICKED_UP (confirm receipt).
     * FEATURE 4: Shows PDF download link when COMPLETED.
     */
    renderCharityRequestCard(r) {
        const label = STATUS_LABELS[r.status] || r.status;
        const color = STATUS_COLORS[r.status] || '#6b7280';

        let actionBtn = '';
        if (r.status === 'FOOD_PICKED_UP') {
            actionBtn = `
            <div class="photo-upload-group mt-sm">
              <label class="small-label">📷 Proof of Delivery URL (optional)</label>
              <input type="url" id="pod-url-${r.id}" class="input-sm" placeholder="https://…/photo.jpg">
            </div>
            <button class="btn-success full-width mt-sm"
                    onclick="app.charityConfirmReceipt('${r.id}')">
              ✓ Confirm Receipt
            </button>`;
        } else if (r.status === 'DELIVERED_TO_CHARITY') {
            actionBtn = `<button class="btn-primary full-width mt-sm"
                                 onclick="app.charityCompleteDelivery('${r.id}')">
                           🎉 Mark as Completed
                         </button>`;
        }

        const receiptBtn = r.status === 'COMPLETED' && r.receipt_path
            ? `<a class="btn-sm btn-outline" href="${this.api.getReceiptUrl(r.id)}" target="_blank">📄 Receipt</a>`
            : '';

        return `
        <div class="delivery-card">
          <div class="delivery-header">
            <h3>${r.food_description}</h3>
            <span class="status-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${label}</span>
          </div>
          <div class="delivery-body">
            <p><strong>Quantity:</strong> ${r.quantity}</p>
            <p><strong>Pickup:</strong> ${r.pickup_address}</p>
            ${r.preferred_pickup_time ? `<p><strong>Time:</strong> ${r.preferred_pickup_time}</p>` : ''}
            <p><strong>Host:</strong> ${r.host_name} ${r.host_phone ? '· ' + r.host_phone : ''}</p>
            ${r.volunteer_name
                ? `<p>🚴 <strong>Volunteer:</strong> ${r.volunteer_name} ${r.volunteer_phone ? '· ' + r.volunteer_phone : ''}</p>`
                : '<p class="text-muted">⏳ Waiting for a volunteer to accept…</p>'}
          </div>
          ${actionBtn}
          ${receiptBtn}
        </div>`;
    }

    /**
     * FEATURE 1: Reads photo URL from the optional input before confirming receipt.
     */
    async charityConfirmReceipt(id) {
        const photoUrl = document.getElementById(`pod-url-${id}`)?.value?.trim() || null;
        try {
            await this.api.confirmReceipt(id, photoUrl);
            this.showToast(
                photoUrl ? 'Receipt confirmed with photo proof! 🎉' : 'Receipt confirmed! 🎉',
                'success'
            );
            await this.loadCharityMyRequests();
        } catch (err) {
            this.showToast(err.message || 'Could not confirm receipt.', 'error');
        }
    }

    async charityCompleteDelivery(id) {
        try {
            const res = await this.api.completeDelivery(id);
            const msg = res.data?.receiptFilename
                ? 'Delivery completed! PDF receipt generated. 🌟'
                : 'Delivery marked as completed! 🌟';
            this.showToast(msg, 'success');
            await this.loadCharityMyRequests();
        } catch (err) {
            this.showToast(err.message || 'Could not complete delivery.', 'error');
        }
    }

    // ─────────────────────────────────────────
    // VOLUNTEER DASHBOARD
    // ─────────────────────────────────────────

    async loadVolunteerDashboard() {
        await Promise.all([
            this.loadAvailablePickups(),
            this.loadMyDeliveries()
        ]);
    }

    /**
     * FEATURE 2: Highlights nearby pickups with a special badge + distance label.
     * FEATURE 3: Shows countdown for expiring food.
     */
    async loadAvailablePickups() {
        const container = document.getElementById('requestsGrid') || document.getElementById('availablePickupsGrid');
        if (!container) return;
        this.clearExpiryTimers();
        container.innerHTML = '<div class="spinner"></div>';
        try {
            const res  = await this.api.getAvailablePickups();
            const list = res.data.pickups || [];
            if (!list.length) {
                container.innerHTML = '<p class="text-center text-muted">No pickups available right now. Check back soon!</p>';
                return;
            }
            container.innerHTML = list.map((p) => {
                // Feature 2: nearby badge
                const nearbyBadge = p.nearby
                    ? `<span class="request-badge nearby">📍 Nearby ${p.distanceKm !== null ? `· ${p.distanceKm} km` : ''}</span>`
                    : (p.distanceKm !== null
                        ? `<span class="request-badge">${p.distanceKm} km away</span>`
                        : `<span class="request-badge">Available</span>`);

                // Feature 3: expiry countdown
                const expiryHtml = p.expiry_time
                    ? this.renderExpiryBadge(p.id + '-vol', p.expiry_time)
                    : '';

                return `
                <div class="request-card ${p.nearby ? 'card-nearby' : ''}" data-id="${p.id}">
                  <div class="request-header">
                    <div class="request-title">${p.food_description}</div>
                    ${nearbyBadge}
                  </div>
                  ${expiryHtml}
                  <div class="request-details">
                    <div class="request-detail"><span>🍽️</span> ${p.quantity}</div>
                    <div class="request-detail"><span>📍</span> ${p.pickup_address}</div>
                    ${p.preferred_pickup_time ? `<div class="request-detail"><span>⏰</span> ${p.preferred_pickup_time}</div>` : ''}
                    <div class="request-detail"><span>🏠</span> Host: ${p.host_name}</div>
                    <div class="request-detail"><span>🏥</span> Deliver to: ${p.charity_name}</div>
                  </div>
                  ${p.notes ? `<p class="request-notes">${p.notes}</p>` : ''}
                  <div class="request-footer">
                    <button class="btn-accept"  onclick="app.volunteerAcceptPickup('${p.id}', this)">Accept Pickup</button>
                    <button class="btn-decline" onclick="app.volunteerDeclinePickup('${p.id}', this)">Decline</button>
                  </div>
                </div>`;
            }).join('');
        } catch {
            container.innerHTML = '<p class="error">Could not load available pickups.</p>';
        }
    }

    async volunteerAcceptPickup(id, btn) {
        if (btn) { btn.textContent = 'Accepting…'; btn.disabled = true; }
        try {
            await this.api.acceptPickup(id);
            this.showToast('Pickup accepted! Head to the pickup address. 🚴', 'success');
            await this.loadVolunteerDashboard();
        } catch (err) {
            this.showToast(err.message || 'Could not accept pickup.', 'error');
            if (btn) { btn.textContent = 'Accept Pickup'; btn.disabled = false; }
        }
    }

    /**
     * FEATURE 6: Prompts for a reason before declining.
     */
    async volunteerDeclinePickup(id, btn) {
        const reason = window.prompt('Please provide a reason for declining (optional):');
        if (reason === null) return;  // User pressed Cancel — abort

        if (btn) { btn.textContent = 'Declining…'; btn.disabled = true; }
        try {
            await this.api.declinePickup(id, reason || null);
            this.showToast('Pickup declined.', 'info');
            await this.loadAvailablePickups();
        } catch (err) {
            this.showToast(err.message || 'Could not decline.', 'error');
            if (btn) { btn.textContent = 'Decline'; btn.disabled = false; }
        }
    }

    async loadMyDeliveries() {
        const container = document.getElementById('myDeliveriesGrid') || document.getElementById('deliveriesList');
        if (!container) return;
        try {
            const res  = await this.api.getMyDeliveries();
            const list = res.data.deliveries || [];
            if (!list.length) return;
            container.innerHTML = list.map((d) => this.renderVolunteerDeliveryCard(d)).join('');
        } catch { /* silent fail — not the primary content */ }
    }

    /**
     * FEATURE 1: Photo URL input when confirming food collected (FOOD_PICKED_UP).
     * FEATURE 3: Expiry countdown on active deliveries.
     */
    renderVolunteerDeliveryCard(d) {
        const label = STATUS_LABELS[d.status] || d.status;
        const color = STATUS_COLORS[d.status] || '#6b7280';

        // Feature 3: show countdown for active pickups
        const countdown = d.expiry_time && d.status !== 'FOOD_PICKED_UP'
            ? this.renderExpiryBadge(d.id + '-del', d.expiry_time)
            : '';

        let actionBtn = '';
        if (d.status === 'VOLUNTEER_ASSIGNED') {
            actionBtn = `<button class="btn-primary full-width mt-sm"
                                 onclick="app.volunteerUpdateStatus('${d.id}','PICKUP_IN_PROGRESS')">
                           🚴 Start Pickup Journey
                         </button>`;
        } else if (d.status === 'PICKUP_IN_PROGRESS') {
            // Feature 1: photo URL input when confirming collection
            actionBtn = `
            <div class="photo-upload-group mt-sm">
              <label class="small-label">📷 Photo Proof of Collection (optional)</label>
              <input type="url" id="poc-url-${d.id}" class="input-sm" placeholder="https://…/photo.jpg">
            </div>
            <button class="btn-primary full-width mt-sm"
                    onclick="app.volunteerUpdateStatus('${d.id}','FOOD_PICKED_UP',document.getElementById('poc-url-${d.id}')?.value||null)">
              📦 Confirm Food Collected
            </button>`;
        }

        return `
        <div class="delivery-card">
          <div class="delivery-header">
            <h3>${d.food_description}</h3>
            <span class="status-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${label}</span>
          </div>
          ${countdown}
          <div class="delivery-body">
            <p><strong>Pick up from:</strong> ${d.host_name} — ${d.pickup_address}</p>
            ${d.preferred_pickup_time ? `<p><strong>Time:</strong> ${d.preferred_pickup_time}</p>` : ''}
            <p><strong>Deliver to:</strong> ${d.charity_name}</p>
            ${d.host_phone ? `<p>📞 Host: ${d.host_phone}</p>` : ''}
            ${d.notes ? `<p><em>${d.notes}</em></p>` : ''}
          </div>
          ${actionBtn}
        </div>`;
    }

    /**
     * FEATURE 1: Passes photoUrl to the API.
     */
    async volunteerUpdateStatus(id, status, photoUrl = null) {
        try {
            await this.api.updateDeliveryStatus(id, status, photoUrl || null);
            const labels = {
                PICKUP_IN_PROGRESS: 'Journey started! 🚴 Head to the pickup address.',
                FOOD_PICKED_UP:     photoUrl
                    ? 'Food collected with photo proof! 📦 Head to the charity.'
                    : 'Food collected! 📦 Head to the charity now.'
            };
            this.showToast(labels[status] || 'Status updated.', 'success');
            await this.loadMyDeliveries();
        } catch (err) {
            this.showToast(err.message || 'Could not update status.', 'error');
        }
    }

    // ─────────────────────────────────────────
    // ORDERS (all roles — full audit view)
    // ─────────────────────────────────────────

    async loadMyOrders() {
        const container = document.getElementById('ordersContainer');
        if (!container) return;
        container.innerHTML = '<div class="spinner"></div>';
        try {
            const res    = await this.api.getMyOrders();
            const orders = res.data?.orders ?? [];
            if (!orders.length) {
                container.innerHTML = '<div class="empty-state"><p>No orders yet.</p></div>';
                return;
            }
            container.innerHTML = orders.map((o) => this.renderOrderCard(o)).join('');
        } catch (err) {
            container.innerHTML = '<p class="error">Could not load orders.</p>';
        }
    }

    /**
     * FEATURE 1: Timeline events that have photo_url now show a thumbnail.
     */
    renderOrderCard(order) {
        const color = STATUS_COLORS[order.status] || '#6b7280';
        const label = STATUS_LABELS[order.status] || order.status;

        const STEPS = [
            { key: 'REQUESTED',            icon: '📝', label: 'Requested' },
            { key: 'ACCEPTED_BY_CHARITY',  icon: '🏥', label: 'Charity Accepted' },
            { key: 'VOLUNTEER_ASSIGNED',   icon: '🚴', label: 'Volunteer Assigned' },
            { key: 'PICKUP_IN_PROGRESS',   icon: '🚚', label: 'Pickup' },
            { key: 'FOOD_PICKED_UP',       icon: '📦', label: 'Collected' },
            { key: 'DELIVERED_TO_CHARITY', icon: '🏥', label: 'Delivered' },
            { key: 'COMPLETED',            icon: '🎉', label: 'Completed' }
        ];

        const ORDER      = STEPS.map(s => s.key);
        const currentIdx = ORDER.indexOf(order.status);
        const progressHTML = STEPS.map((step, i) => {
            const isDone    = i < currentIdx;
            const isCurrent = i === currentIdx;
            return `
            <div class="order-step ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}">
              <div class="step-icon">${step.icon}</div>
              <div class="step-label">${step.label}</div>
            </div>
            ${i < STEPS.length - 1 ? `<div class="step-connector ${isDone ? 'done' : ''}"></div>` : ''}`;
        }).join('');

        const actorIcons = { host: '🏠', volunteer: '🚴', charity: '🏥', system: '⚙️' };
        const timeline   = order.timeline || [];
        const timelineHTML = timeline.map((ev) => `
          <div class="timeline-event">
            <div class="timeline-dot ${ev.actor}"></div>
            <div class="timeline-content">
              <div class="timeline-header">
                <span class="timeline-actor">${actorIcons[ev.actor] || '•'} ${ev.actor}</span>
                <span class="timeline-time">${DateTimeUtils.timeAgo(ev.timestamp)}</span>
              </div>
              <div class="timeline-event-name"><strong>${ev.event}</strong></div>
              ${ev.note ? `<div class="timeline-note">${ev.note}</div>` : ''}
              ${ev.photo_url
                  ? `<a href="${ev.photo_url}" target="_blank" rel="noopener">
                       <img class="timeline-photo" src="${ev.photo_url}" alt="Proof photo"
                            onerror="this.style.display='none'">
                     </a>`
                  : ''}
            </div>
          </div>`).join('');

        const receiptBtn = order.status === 'COMPLETED' && order.receipt_path
            ? `<a class="btn-sm btn-outline" href="${this.api.getReceiptUrl(order.id)}" target="_blank">📄 Receipt</a>`
            : '';

        return `
        <div class="order-card">
          <div class="order-card-header">
            <div class="order-meta">
              <h3 class="order-food-type">${order.food_description}</h3>
              <span class="order-servings">${order.quantity}</span>
            </div>
            <span class="order-status-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${label}</span>
          </div>
          <div class="order-parties">
            <div class="party-pill">🏠 <span>${order.host_name || 'Host'}</span></div>
            <div class="party-arrow">→</div>
            <div class="party-pill ${order.charity_name ? '' : 'empty'}">🏥 <span>${order.charity_name || 'Awaiting charity'}</span></div>
            <div class="party-arrow">→</div>
            <div class="party-pill ${order.volunteer_name ? '' : 'empty'}">🚴 <span>${order.volunteer_name || 'Awaiting volunteer'}</span></div>
          </div>
          <div class="order-progress">${progressHTML}</div>
          ${timeline.length ? `
          <details class="order-timeline-details">
            <summary>📋 Audit trail (${timeline.length} events)</summary>
            <div class="order-timeline">${timelineHTML}</div>
          </details>` : ''}
          <div class="order-footer">
            <span class="order-id">ID: ${order.id}</span>
            ${receiptBtn}
            <button class="btn-sm btn-outline" onclick="app.refreshOrder('${order.id}')">🔄 Refresh</button>
          </div>
        </div>`;
    }

    async refreshOrder(id) {
        this.showToast('Refreshing…', 'info');
        await this.loadMyOrders();
    }

    // ─────────────────────────────────────────
    // FEATURE 5 · IMPACT LEADERBOARD
    // ─────────────────────────────────────────

    async loadLeaderboard() {
        const container = document.getElementById('leaderboard');
        if (!container) return;
        if (!this.api.isLoggedIn()) {
            container.innerHTML = '<p style="color:#6b7280;font-size:.875rem;text-align:center;padding:1rem;">Log in to see the leaderboard.</p>';
            return;
        }
        container.innerHTML = '<div class="spinner"></div>';
        try {
            const res  = await this.api.getLeaderboard();
            const { hosts, volunteers } = res.data;
            container.innerHTML = this.renderLeaderboard(hosts, volunteers);
        } catch {
            container.innerHTML = '<p class="error">Could not load leaderboard.</p>';
        }
    }

    renderLeaderboard(hosts, volunteers) {
        const medal = (i) => ['🥇','🥈','🥉'][i] || `#${i + 1}`;

        const hostRows = hosts.length
            ? hosts.map((h, i) => `
              <tr>
                <td class="rank">${medal(i)}</td>
                <td>${h.name}</td>
                <td class="stat">${h.total_donations}</td>
                <td class="stat">${h.total_servings.toLocaleString()}</td>
              </tr>`).join('')
            : '<tr><td colspan="4" class="empty">No data yet</td></tr>';

        const volRows = volunteers.length
            ? volunteers.map((v, i) => `
              <tr>
                <td class="rank">${medal(i)}</td>
                <td>${v.name}</td>
                <td class="stat">${v.total_deliveries}</td>
                <td class="stat">${v.total_servings_delivered.toLocaleString()}</td>
              </tr>`).join('')
            : '<tr><td colspan="4" class="empty">No data yet</td></tr>';

        return `
        <div class="leaderboard-wrap">
          <div class="leaderboard-half">
            <h3>🏠 Top Hosts</h3>
            <table class="lb-table">
              <thead><tr><th>Rank</th><th>Name</th><th>Donations</th><th>Servings</th></tr></thead>
              <tbody>${hostRows}</tbody>
            </table>
          </div>
          <div class="leaderboard-half">
            <h3>🚴 Top Volunteers</h3>
            <table class="lb-table">
              <thead><tr><th>Rank</th><th>Name</th><th>Deliveries</th><th>Servings</th></tr></thead>
              <tbody>${volRows}</tbody>
            </table>
          </div>
        </div>`;
    }

    // ─────────────────────────────────────────
    // FEATURE 7 · CHARITY WISHLIST
    // ─────────────────────────────────────────

    /** Host view: browse what charities need before creating a donation. */
    async loadWishlistForHosts() {
        const container = document.getElementById('charityNeedsPanel');
        if (!container) return;
        try {
            const res   = await this.api.getCharityWishlistForHosts();
            const items = res.data.items || [];
            if (!items.length) {
                container.innerHTML = '<p class="text-muted">No charity needs listed right now.</p>';
                return;
            }
            container.innerHTML = `
            <h4 class="section-subtitle">🏥 What Charities Need</h4>
            <div class="wishlist-grid">
              ${items.map(item => this._renderWishlistCard(item, false)).join('')}
            </div>`;
        } catch { /* non-critical panel */ }
    }

    /** Charity view: manage their own wishlist. */
    async loadCharityWishlist() {
        const container = document.getElementById('wishlistContainer');
        if (!container) return;
        container.innerHTML = '<div class="spinner"></div>';
        try {
            const res   = await this.api.getCharityWishlist();
            const items = res.data.items || [];
            container.innerHTML = `
            <div class="wishlist-grid">
              ${items.length
                  ? items.map(item => this._renderWishlistCard(item, true)).join('')
                  : '<p class="empty-state">Your wishlist is empty. Add items above.</p>'}
            </div>`;
        } catch {
            container.innerHTML = '<p class="error">Could not load wishlist.</p>';
        }
    }

    _renderWishlistCard(item, showDelete) {
        const color  = URGENCY_COLORS[item.urgency_level] || '#6b7280';
        const ulgLbl = URGENCY_LABELS[item.urgency_level]  || item.urgency_level;
        return `
        <div class="wishlist-card">
          <div class="wishlist-card-header">
            <strong>${item.item_name}</strong>
            <span class="urgency-badge" style="color:${color};border-color:${color}40;background:${color}15">
              ${ulgLbl}
            </span>
          </div>
          ${item.charity_name ? `<p class="wishlist-charity">🏥 ${item.charity_name}</p>` : ''}
          ${item.notes ? `<p class="wishlist-notes">${item.notes}</p>` : ''}
          ${showDelete
              ? `<button class="btn-sm btn-danger mt-sm" onclick="app.deleteWishlistItem('${item.id}')">🗑 Remove</button>`
              : ''}
        </div>`;
    }

    async handleWishlistSubmit(form) {
        const fd  = new FormData(form);
        const btn = form.querySelector('[type="submit"]');
        if (btn) { btn.textContent = 'Adding…'; btn.disabled = true; }
        try {
            await this.api.addWishlistItem({
                item_name:     fd.get('item_name')     || '',
                urgency_level: fd.get('urgency_level') || 'medium',
                notes:         fd.get('notes')          || null
            });
            form.reset();
            this.showToast('Item added to wishlist!', 'success');
            await this.loadCharityWishlist();
        } catch (err) {
            this.showToast(err.message || 'Could not add item.', 'error');
        } finally {
            if (btn) { btn.textContent = 'Add Item'; btn.disabled = false; }
        }
    }

    async deleteWishlistItem(id) {
        if (!confirm('Remove this item from your wishlist?')) return;
        try {
            await this.api.deleteWishlistItem(id);
            this.showToast('Item removed.', 'info');
            await this.loadCharityWishlist();
        } catch (err) {
            this.showToast(err.message || 'Could not remove item.', 'error');
        }
    }

    // ─────────────────────────────────────────
    // FEATURE 10 · ADMIN STALE REQUESTS
    // ─────────────────────────────────────────

    async loadStaleRequests(hours = 2) {
        const container = document.getElementById('staleRequestsContainer');
        if (!container) return;
        container.innerHTML = '<div class="spinner"></div>';
        try {
            const res  = await this.api.getStaleRequests(hours);
            const list = res.data.staleRequests || [];
            if (!list.length) {
                container.innerHTML = `<div class="empty-state"><p>✅ No requests have been stuck in "Awaiting Volunteer" for more than ${hours} hour(s).</p></div>`;
                return;
            }
            container.innerHTML = `
            <div class="stale-alert">
              ⚠️ ${list.length} request(s) stuck in ACCEPTED_BY_CHARITY for over ${hours} hour(s)
            </div>
            ${list.map(r => this._renderStaleCard(r)).join('')}`;
        } catch {
            container.innerHTML = '<p class="error">Could not load stale requests.</p>';
        }
    }

    _renderStaleCard(r) {
        const hoursStale = Math.floor(r.minutes_stale / 60);
        const minsStale  = r.minutes_stale % 60;
        const urgency    = r.minutes_stale > 240 ? '#ef4444' : '#f97316';  // > 4 h = red
        return `
        <div class="stale-card" style="border-left:4px solid ${urgency}">
          <div class="stale-header">
            <strong>${r.food_description}</strong>
            <span class="stale-timer" style="color:${urgency}">
              🕐 Stale for ${hoursStale}h ${minsStale}m
            </span>
          </div>
          <p>📍 ${r.pickup_address}</p>
          <p>🏠 Host: ${r.host_name} ${r.host_phone ? '· ' + r.host_phone : ''}</p>
          <p>🏥 Charity: ${r.charity_name}</p>
          <p class="donation-meta">ID: ${r.id} · Accepted: ${DateTimeUtils.timeAgo(r.updated_at)}</p>
        </div>`;
    }

    // ─────────────────────────────────────────
    // DASHBOARD (admin / home stats)
    // ─────────────────────────────────────────

    async loadDashboardData() {
        if (!this.api.isLoggedIn()) return;
        try {
            const res  = await this.api.getDashboardStats();
            const data = res.data;
            const set  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            set('statTotalRequests',  data.totalRequests);
            set('statCompleted',      data.completedDeliveries);
            set('statVolunteers',     data.activeVolunteers);
            set('statCharities',      data.verifiedCharities);
            set('statOpen',           data.openRequests);
            set('statInFlight',       data.inFlightDeliveries);
        } catch { /* dashboard stats are non-critical */ }
    }

    // ─────────────────────────────────────────
    // PROFILE
    // ─────────────────────────────────────────

    async loadProfile() {
        try {
            const res  = await this.api.getProfile();
            if (!res.success) return;
            const user = res.data;
            const set  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '–'; };

            const initials = (user.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
            const avatar   = document.getElementById('profileAvatar');
            if (avatar) avatar.textContent = initials;

            const fmt = user.created_at
                ? new Date(user.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                : '–';

            set('profileName',         user.name);
            set('profileEmail',        user.email);
            set('profilePhone',        user.phone);
            set('profileCreated',      fmt);
            set('profileNameDetail',   user.name);
            set('profileEmailDetail',  user.email);
            set('profilePhoneDetail',  user.phone || '–');
            set('profileCreatedDetail',fmt);

            const roleMap = {
                host:      { icon: '🏠', label: 'Food Host',    desc: 'You list surplus food and schedule pickups.' },
                volunteer: { icon: '🚴', label: 'Volunteer',    desc: 'You pick up food and deliver it to charities.' },
                charity:   { icon: '🏥', label: 'Charity / NGO', desc: 'You accept donations and distribute food.' },
                admin:     { icon: '⚙️', label: 'Admin',        desc: 'Full access to platform management tools.' }
            };
            const info = roleMap[user.role] || { icon: '👤', label: user.role || 'Member', desc: '' };

            const elems = {
                profileRoleIcon:     info.icon,
                profileRoleLabel:    info.label,
                profileRoleDetail:   `${info.icon} ${info.label}`,
                profileRoleInfoIcon: info.icon,
                profileRoleInfoTitle:info.label,
                profileRoleInfoDesc: info.desc
            };
            Object.entries(elems).forEach(([id, val]) => set(id, val));
        } catch (err) {
            console.error('Profile load failed:', err);
        }
    }

    // ─────────────────────────────────────────
    // COUNTERS & OBSERVERS
    // ─────────────────────────────────────────

    setupCounters() {
        document.querySelectorAll('[data-count]').forEach((counter) => {
            const target    = parseInt(counter.dataset.count || '0');
            const duration  = 2000;
            const increment = target / (duration / 16);
            let current     = 0;
            const update = () => {
                current += increment;
                if (current < target) {
                    counter.textContent = String(Math.floor(current));
                    requestAnimationFrame(update);
                } else {
                    counter.textContent = String(target);
                }
            };
            const obs = new IntersectionObserver((entries) => {
                entries.forEach((e) => { if (e.isIntersecting) { update(); obs.unobserve(e.target); } });
            });
            obs.observe(counter);
        });
    }

    setupIntersectionObserver() {
        const obs = new IntersectionObserver(
            (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('visible'); }),
            { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
        );
        document.querySelectorAll('.fade-in-up,.fade-in-left,.fade-in-right,.stagger-children')
                .forEach((el) => obs.observe(el));
    }

    // ─────────────────────────────────────────
    // TOAST
    // ─────────────────────────────────────────

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-message">${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
}

// ─────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────

let app;
document.addEventListener('DOMContentLoaded', () => { app = new CommunityApp(); });