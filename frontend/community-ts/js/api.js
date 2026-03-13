/* ========================================
   COMMUNITY - API Client (compiled JS)
   Aligned with new donation lifecycle:
   REQUESTED → ACCEPTED_BY_CHARITY → VOLUNTEER_ASSIGNED
   → PICKUP_IN_PROGRESS → FOOD_PICKED_UP
   → DELIVERED_TO_CHARITY → COMPLETED
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

class CommunityAPI {
    constructor(baseURL = '/api/community') {
        this.baseURL = baseURL;
    }

    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('community_token');
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

    async createDonation(body) {
        return this.request('POST', '/host/donations', body);
    }

    async getMyDonations() {
        return this.request('GET', '/host/donations');
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

    async confirmReceipt(donationRequestId) {
        return this.request('POST', `/charity/confirm-receipt/${donationRequestId}`);
    }

    async completeDelivery(donationRequestId) {
        return this.request('POST', `/charity/complete/${donationRequestId}`);
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

    async declinePickup(donationRequestId) {
        return this.request('POST', `/volunteer/decline-pickup/${donationRequestId}`);
    }

    async getMyDeliveries() {
        return this.request('GET', '/volunteer/my-deliveries');
    }

    async updateDeliveryStatus(donationRequestId, status) {
        return this.request('PATCH', `/volunteer/update-status/${donationRequestId}`, { status });
    }

    // ── SHARED ──────────────────────────────

    async getDonationRequest(id) {
        return this.request('GET', `/donation-requests/${id}`);
    }

    async getTimeline(id) {
        return this.request('GET', `/donation-requests/${id}/timeline`);
    }

    async getMyOrders() {
        return this.request('GET', '/orders/mine');
    }

    // ── DASHBOARD ───────────────────────────

    async getDashboardStats() {
        return this.request('GET', '/dashboard/stats');
    }
}