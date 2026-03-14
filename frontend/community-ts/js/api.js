/* ========================================
   COMMUNITY - API Client  (Feature Pack v2)

   New methods / changed signatures:
   ─ createDonation()       — now accepts expiryTime, pickupLat, pickupLng
   ─ confirmReceipt()       — now accepts photoUrl  (Feature 1)
   ─ declinePickup()        — now accepts reason    (Feature 6)
   ─ updateDeliveryStatus() — now accepts photoUrl  (Feature 1)
   ─ getLeaderboard()       — new                   (Feature 5)
   ─ getCharityWishlist()   — new                   (Feature 7)
   ─ addWishlistItem()      — new                   (Feature 7)
   ─ deleteWishlistItem()   — new                   (Feature 7)
   ─ getCharityWishlistForHosts() — new             (Feature 7)
   ─ getStaleRequests()     — new admin             (Feature 10)
   ─ getReceiptUrl()        — new                   (Feature 4)
   ======================================== */

const STATUS_LABELS = {
    REQUESTED:            'Awaiting Charity',
    ACCEPTED_BY_CHARITY:  'Awaiting Volunteer',
    VOLUNTEER_ASSIGNED:   'Volunteer Assigned',
    PICKUP_IN_PROGRESS:   'En Route to Pickup',
    FOOD_PICKED_UP:       'Food Collected',
    DELIVERED_TO_CHARITY: 'Delivered to Charity',
    COMPLETED:            'Completed',
    CANCELLED:            'Cancelled'
};

const STATUS_COLORS = {
    REQUESTED:            '#3b82f6',
    ACCEPTED_BY_CHARITY:  '#8b5cf6',
    VOLUNTEER_ASSIGNED:   '#f59e0b',
    PICKUP_IN_PROGRESS:   '#f97316',
    FOOD_PICKED_UP:       '#06b6d4',
    DELIVERED_TO_CHARITY: '#10b981',
    COMPLETED:            '#22c55e',
    CANCELLED:            '#ef4444'
};

const URGENCY_COLORS = {
    low:      '#6b7280',
    medium:   '#f59e0b',
    high:     '#f97316',
    critical: '#ef4444'
};

const URGENCY_LABELS = {
    low:      '🟢 Low',
    medium:   '🟡 Medium',
    high:     '🟠 High',
    critical: '🔴 Critical'
};

class CommunityAPI {
    constructor(baseURL = '/api/community') {
        this.baseURL = baseURL;
    }

    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const token   = localStorage.getItem('community_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    async request(method, endpoint, body = null) {
        try {
            const options = { method, headers: this.getHeaders() };
            if (body) options.body = JSON.stringify(body);
            const response = await fetch(`${this.baseURL}${endpoint}`, options);
            let data;
            try { data = await response.json(); }
            catch { data = { success: false, data: {} }; }
            if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
            return data;
        } catch (err) {
            console.error(`API [${method} ${endpoint}]:`, err);
            throw err;
        }
    }

    // ── AUTH ────────────────────────────────

    async register({ name, email, password, role, phone }) {
        const data = await this.request('POST', '/auth/register', { name, email, password, role, phone });
        if (data.success) localStorage.setItem('community_token', data.data.token);
        return data;
    }

    async login({ email, password }) {
        const data = await this.request('POST', '/auth/login', { email, password });
        if (data.success) localStorage.setItem('community_token', data.data.token);
        return data;
    }

    logout() {
        localStorage.removeItem('community_token');
        localStorage.removeItem('community_user');
    }

    isLoggedIn() { return !!localStorage.getItem('community_token'); }

    async getProfile() { return this.request('GET', '/auth/me'); }

    // ── HOST ────────────────────────────────

    /**
     * FEATURE 2: pickupLat + pickupLng for geofencing.
     * FEATURE 3: expiryTime (ISO-8601 string) for food expiry.
     */
    async createDonation({ foodDescription, quantity, pickupAddress, contactPhone,
                           preferredPickupTime, notes,
                           expiryTime = null,
                           pickupLat  = null,
                           pickupLng  = null }) {
        return this.request('POST', '/host/donations', {
            foodDescription, quantity, pickupAddress, contactPhone,
            preferredPickupTime, notes, expiryTime, pickupLat, pickupLng
        });
    }

    async getMyDonations() {
        return this.request('GET', '/host/donations');
    }

    // FEATURE 7: Hosts browse charity needs before creating a donation
    async getCharityWishlistForHosts() {
        return this.request('GET', '/host/charity-wishlist');
    }

    // ── CHARITY ─────────────────────────────

    async getAvailableRequests() {
        return this.request('GET', '/charity/available');
    }

    async acceptRequest(donationRequestId) {
        return this.request('POST', `/charity/accept/${donationRequestId}`);
    }

    async getCharityRequests() {
        return this.request('GET', '/charity/my-requests');
    }

    /**
     * FEATURE 1: photoUrl attaches a proof-of-delivery image to the timeline event.
     */
    async confirmReceipt(donationRequestId, photoUrl = null) {
        return this.request('POST', `/charity/confirm-receipt/${donationRequestId}`, {
            photo_url: photoUrl
        });
    }

    async completeDelivery(donationRequestId) {
        return this.request('POST', `/charity/complete/${donationRequestId}`);
    }

    /**
     * Charity cancels a mistaken accept — returns request to the available pool.
     * Only works before a volunteer is assigned (status = ACCEPTED_BY_CHARITY).
     */
    async cancelAcceptedRequest(donationRequestId, reason = null) {
        return this.request('POST', `/charity/cancel/${donationRequestId}`, { reason });
    }

    // FEATURE 7: Charity manages their wishlist
    async getCharityWishlist() {
        return this.request('GET', '/charity/wishlist');
    }

    async addWishlistItem({ item_name, urgency_level = 'medium', notes = null }) {
        return this.request('POST', '/charity/wishlist', { item_name, urgency_level, notes });
    }

    async deleteWishlistItem(itemId) {
        return this.request('DELETE', `/charity/wishlist/${itemId}`);
    }

    // ── VOLUNTEER ───────────────────────────

    async registerAsVolunteer(body) {
        return this.request('POST', '/volunteer/register', body);
    }

    async getAvailablePickups() {
        return this.request('GET', '/volunteer/available-pickups');
    }

    async acceptPickup(donationRequestId) {
        return this.request('POST', `/volunteer/accept-pickup/${donationRequestId}`);
    }

    /**
     * FEATURE 6: reason is logged as a note in the timeline.
     */
    async declinePickup(donationRequestId, reason = null) {
        return this.request('POST', `/volunteer/decline-pickup/${donationRequestId}`, { reason });
    }

    async getMyDeliveries() {
        return this.request('GET', '/volunteer/my-deliveries');
    }

    /**
     * FEATURE 1: photoUrl attaches proof of collection to the timeline (used at FOOD_PICKED_UP).
     */
    async updateDeliveryStatus(donationRequestId, status, photoUrl = null) {
        return this.request('PATCH', `/volunteer/update-status/${donationRequestId}`, {
            status,
            photo_url: photoUrl
        });
    }

    // ── SHARED ──────────────────────────────

    async getDonationRequest(id) {
        return this.request('GET', `/donation-requests/${id}`);
    }

    async getTimeline(id) {
        return this.request('GET', `/donation-requests/${id}/timeline`);
    }

    /** FEATURE 4: Returns the PDF receipt download URL for a completed request. */
    getReceiptUrl(donationRequestId) {
        return `${this.baseURL}/donation-requests/${donationRequestId}/receipt`;
    }

    async getMyOrders() {
        return this.request('GET', '/orders/mine');
    }

    // ── DASHBOARD ───────────────────────────

    async getDashboardStats() {
        return this.request('GET', '/dashboard/stats');
    }

    // ── LEADERBOARD (FEATURE 5) ──────────────

    async getLeaderboard() {
        return this.request('GET', '/leaderboard');
    }

    // ── ADMIN (FEATURE 10) ───────────────────

    /**
     * @param {number} hours — flag requests stuck longer than this many hours (default 2)
     */
    async getStaleRequests(hours = 2) {
        return this.request('GET', `/admin/stale-requests?hours=${hours}`);
    }

    // ── PHASE 2 ADDITIONS ───────────────────

    async getTrackingData(donationRequestId)  { return this.request('GET', `/tracking/${donationRequestId}`); }

    async createRecurringDonation(body)       { return this.request('POST', '/host/recurring', body); }
    async getMyRecurringDonations()           { return this.request('GET', '/host/recurring'); }
    async updateRecurringDonation(id, body)   { return this.request('PATCH', `/host/recurring/${id}`, body); }
    async deleteRecurringDonation(id)         { return this.request('DELETE', `/host/recurring/${id}`); }

    async getAvailableRequestsFiltered({ vegan = false, glutenFree = false } = {}) {
        const qs = new URLSearchParams();
        if (vegan)      qs.set('vegan', '1');
        if (glutenFree) qs.set('glutenFree', '1');
        return this.request('GET', `/charity/available-v2${qs.toString() ? '?' + qs : ''}`);
    }

    async submitFeedback(donationRequestId, rating, comment = null) {
        return this.request('POST', `/feedback/${donationRequestId}`, { rating, comment });
    }
    async getFeedback(donationRequestId)      { return this.request('GET', `/feedback/${donationRequestId}`); }

    async setVolunteerAvailability(isActive)  { return this.request('PATCH', '/volunteer/availability', { isActive }); }
    async getVolunteerAvailability()          { return this.request('GET', '/volunteer/availability'); }

    getCSVExportUrl({ status = '', from = '', to = '' } = {}) {
        const qs = new URLSearchParams();
        if (status) qs.set('status', status);
        if (from)   qs.set('from', from);
        if (to)     qs.set('to', to);
        return `${this.baseURL}/admin/export/csv?${qs}`;
    }
    async triggerRecurring() { return this.request('POST', '/admin/recurring/trigger'); }
}