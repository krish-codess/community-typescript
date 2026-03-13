/* ========================================
   COMMUNITY - API Client (TypeScript)
   Aligned with the new donation lifecycle:
   REQUESTED → ACCEPTED_BY_CHARITY → VOLUNTEER_ASSIGNED
   → PICKUP_IN_PROGRESS → FOOD_PICKED_UP
   → DELIVERED_TO_CHARITY → COMPLETED
   ======================================== */

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  error?: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: 'host' | 'volunteer' | 'charity' | 'admin';
  phone?: string;
  created_at?: string;
}

interface DonationRequest {
  id: string;
  host_id: string;
  food_description: string;
  quantity: string;
  pickup_address: string;
  contact_phone?: string;
  preferred_pickup_time?: string;
  notes?: string;
  status: DonationStatus;
  accepted_by_charity?: string;
  assigned_volunteer?: string;
  charity_name?: string;
  volunteer_name?: string;
  volunteer_phone?: string;
  host_name?: string;
  host_phone?: string;
  created_at: string;
  updated_at: string;
  timeline?: TimelineEvent[];
}

type DonationStatus =
  | 'REQUESTED'
  | 'ACCEPTED_BY_CHARITY'
  | 'VOLUNTEER_ASSIGNED'
  | 'PICKUP_IN_PROGRESS'
  | 'FOOD_PICKED_UP'
  | 'DELIVERED_TO_CHARITY'
  | 'COMPLETED'
  | 'CANCELLED';

interface TimelineEvent {
  event: string;
  actor: string;
  timestamp: string;
  note?: string;
}

interface CreateDonationBody {
  foodDescription: string;
  quantity: string;
  pickupAddress: string;
  contactPhone?: string;
  preferredPickupTime?: string;
  notes?: string;
}

interface RegisterBody {
  name: string;
  email: string;
  password: string;
  role: string;
  phone?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

interface VolunteerProfileBody {
  vehicleType?: string;
  availability?: unknown;
  lat?: number;
  lng?: number;
}

// ─────────────────────────────────────────
// STATUS LABELS & COLOURS (shared UI util)
// ─────────────────────────────────────────

export const STATUS_LABELS: Record<DonationStatus, string> = {
  REQUESTED:            'Awaiting Charity',
  ACCEPTED_BY_CHARITY:  'Awaiting Volunteer',
  VOLUNTEER_ASSIGNED:   'Volunteer Assigned',
  PICKUP_IN_PROGRESS:   'En Route to Pickup',
  FOOD_PICKED_UP:       'Food Collected',
  DELIVERED_TO_CHARITY: 'Delivered to Charity',
  COMPLETED:            'Completed',
  CANCELLED:            'Cancelled'
};

export const STATUS_COLORS: Record<DonationStatus, string> = {
  REQUESTED:            '#3b82f6',
  ACCEPTED_BY_CHARITY:  '#8b5cf6',
  VOLUNTEER_ASSIGNED:   '#f59e0b',
  PICKUP_IN_PROGRESS:   '#f97316',
  FOOD_PICKED_UP:       '#06b6d4',
  DELIVERED_TO_CHARITY: '#10b981',
  COMPLETED:            '#22c55e',
  CANCELLED:            '#ef4444'
};

// ─────────────────────────────────────────
// API CLIENT
// ─────────────────────────────────────────

class CommunityAPI {
  baseURL: string;

  constructor(baseURL: string = '/api/community') {
    this.baseURL = baseURL;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('community_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  async request<T = any>(method: string, endpoint: string, body: object | null = null): Promise<ApiResponse<T>> {
    try {
      const options: RequestInit = { method, headers: this.getHeaders() };
      if (body) options.body = JSON.stringify(body);

      const response = await fetch(`${this.baseURL}${endpoint}`, options);
      let data: ApiResponse<T>;
      try { data = await response.json(); }
      catch { data = { success: false, data: {} as T }; }

      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      return data;
    } catch (err) {
      console.error(`API [${method} ${endpoint}]:`, err);
      throw err;
    }
  }

  // ── AUTH ────────────────────────────────

  async register(body: RegisterBody): Promise<ApiResponse<{ token: string; user: User }>> {
    const data = await this.request('POST', '/auth/register', body);
    if (data.success) localStorage.setItem('community_token', data.data.token);
    return data;
  }

  async login(body: LoginBody): Promise<ApiResponse<{ token: string; user: User }>> {
    const data = await this.request('POST', '/auth/login', body);
    if (data.success) localStorage.setItem('community_token', data.data.token);
    return data;
  }

  logout(): void {
    localStorage.removeItem('community_token');
    localStorage.removeItem('community_user');
  }

  isLoggedIn(): boolean { return !!localStorage.getItem('community_token'); }

  async getProfile(): Promise<ApiResponse<User>> {
    return this.request('GET', '/auth/me');
  }

  // ── HOST ────────────────────────────────

  /** Create a new donation request (host only) */
  async createDonation(body: CreateDonationBody): Promise<ApiResponse<{ donationRequestId: string; status: DonationStatus }>> {
    return this.request('POST', '/host/donations', body);
  }

  /** Get all donation requests created by the logged-in host */
  async getMyDonations(): Promise<ApiResponse<{ donations: DonationRequest[] }>> {
    return this.request('GET', '/host/donations');
  }

  // ── CHARITY ─────────────────────────────

  /** Browse open donation requests (status = REQUESTED) */
  async getAvailableRequests(): Promise<ApiResponse<{ requests: DonationRequest[] }>> {
    return this.request('GET', '/charity/available');
  }

  /** Accept a donation request — locks it to this charity */
  async acceptRequest(donationRequestId: string): Promise<ApiResponse<{ status: DonationStatus }>> {
    return this.request('POST', `/charity/accept/${donationRequestId}`);
  }

  /** Get charity's own accepted requests */
  async getCharityRequests(): Promise<ApiResponse<{ requests: DonationRequest[] }>> {
    return this.request('GET', '/charity/my-requests');
  }

  /** Confirm receipt of food delivery */
  async confirmReceipt(donationRequestId: string): Promise<ApiResponse<{ status: DonationStatus }>> {
    return this.request('POST', `/charity/confirm-receipt/${donationRequestId}`);
  }

  /** Mark delivery as fully complete */
  async completeDelivery(donationRequestId: string): Promise<ApiResponse<{ status: DonationStatus }>> {
    return this.request('POST', `/charity/complete/${donationRequestId}`);
  }

  // ── VOLUNTEER ───────────────────────────

  /** Save / update volunteer profile */
  async registerAsVolunteer(body: VolunteerProfileBody): Promise<ApiResponse<{ message: string }>> {
    return this.request('POST', '/volunteer/register', body);
  }

  /** Browse pickups waiting for a volunteer (status = ACCEPTED_BY_CHARITY) */
  async getAvailablePickups(): Promise<ApiResponse<{ pickups: DonationRequest[] }>> {
    return this.request('GET', '/volunteer/available-pickups');
  }

  /** Accept a specific pickup */
  async acceptPickup(donationRequestId: string): Promise<ApiResponse<{ status: DonationStatus }>> {
    return this.request('POST', `/volunteer/accept-pickup/${donationRequestId}`);
  }

  /** Decline a pickup (volunteer changes mind) */
  async declinePickup(donationRequestId: string): Promise<ApiResponse<{ status: DonationStatus }>> {
    return this.request('POST', `/volunteer/decline-pickup/${donationRequestId}`);
  }

  /** Get volunteer's own active deliveries */
  async getMyDeliveries(): Promise<ApiResponse<{ deliveries: DonationRequest[] }>> {
    return this.request('GET', '/volunteer/my-deliveries');
  }

  /**
   * Advance delivery status:
   * VOLUNTEER_ASSIGNED → PICKUP_IN_PROGRESS → FOOD_PICKED_UP
   */
  async updateDeliveryStatus(donationRequestId: string, status: 'PICKUP_IN_PROGRESS' | 'FOOD_PICKED_UP'): Promise<ApiResponse<{ status: DonationStatus }>> {
    return this.request('PATCH', `/volunteer/update-status/${donationRequestId}`, { status });
  }

  // ── SHARED ──────────────────────────────

  /** Get full details + timeline for any donation request */
  async getDonationRequest(id: string): Promise<ApiResponse<DonationRequest>> {
    return this.request('GET', `/donation-requests/${id}`);
  }

  async getTimeline(id: string): Promise<ApiResponse<{ timeline: TimelineEvent[] }>> {
    return this.request('GET', `/donation-requests/${id}/timeline`);
  }

  /** Role-aware order feed for the logged-in user */
  async getMyOrders(): Promise<ApiResponse<{ orders: DonationRequest[] }>> {
    return this.request('GET', '/orders/mine');
  }

  // ── DASHBOARD ───────────────────────────

  async getDashboardStats(): Promise<ApiResponse<{
    totalRequests: number;
    completedDeliveries: number;
    activeVolunteers: number;
    verifiedCharities: number;
    openRequests: number;
    inFlightDeliveries: number;
  }>> {
    return this.request('GET', '/dashboard/stats');
  }
}