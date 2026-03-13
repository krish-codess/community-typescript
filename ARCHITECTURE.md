# COMMUNITY — Donation Platform: Architecture & Refactor Notes

## What Changed & Why

### Problems with the original code

| Area | Problem |
|---|---|
| Status model | Mixed `pending / accepted / in_progress / completed` strings — no enum, no enforced lifecycle |
| Roles | Charity and volunteer routes were blurred; charity could manually assign volunteers, bypassing the workflow |
| DB schema | `requests` and `donations` tables were duplicated and loosely joined; `pickups` / `deliveries` were partially orphaned |
| API routes | Mixed REST conventions (`/donations/:id/accept-by-charity`, `/requests/accept`, `/charity/assign-volunteer`) — no role guard on most routes |
| Frontend | `loadCharityIncomingDeliveries()` and `loadCharityFeed()` loaded the same data differently; status label mapping was duplicated in two places |

---

## New Architecture

### Database: 2 core tables instead of 5

```
users                    — authentication + roles
  └── volunteers         — vehicle, availability, coords
  └── charities          — name, address, verified

donation_requests        — single source of truth for every donation lifecycle
  └── request_timeline   — append-only audit trail
```

The old `donations + requests + pickups + deliveries + activity_log` five-table chain is replaced by a single `donation_requests` table that carries all status transitions and foreign keys to the parties involved.

---

### Request Lifecycle (Status Enum)

```
HOST creates request
        │
        ▼
  [ REQUESTED ]  ◄── visible to ALL charities
        │
  Charity clicks "Accept Request"
        │
        ▼
  [ ACCEPTED_BY_CHARITY ]  ◄── hidden from other charities
        │                       visible to ALL volunteers
  Volunteer clicks "Accept Pickup"
        │
        ▼
  [ VOLUNTEER_ASSIGNED ]
        │
  Volunteer: "Start Journey"
        │
        ▼
  [ PICKUP_IN_PROGRESS ]
        │
  Volunteer: "Confirm Collected"
        │
        ▼
  [ FOOD_PICKED_UP ]
        │
  Charity: "Confirm Receipt"
        │
        ▼
  [ DELIVERED_TO_CHARITY ]
        │
  Charity: "Mark Complete"
        │
        ▼
  [ COMPLETED ]
```

Cancellation is possible from `REQUESTED`, `ACCEPTED_BY_CHARITY`, or `VOLUNTEER_ASSIGNED`.

---

### API Endpoints

#### Auth
| Method | Endpoint | Who |
|---|---|---|
| POST | `/auth/register` | Anyone |
| POST | `/auth/login` | Anyone |
| GET | `/auth/me` | Authenticated |

#### Host
| Method | Endpoint | Who |
|---|---|---|
| POST | `/host/donations` | host |
| GET | `/host/donations` | host, admin |

#### Charity
| Method | Endpoint | Who |
|---|---|---|
| GET | `/charity/available` | charity, admin — returns REQUESTED items only |
| POST | `/charity/accept/:id` | charity — atomic lock prevents double-accept |
| GET | `/charity/my-requests` | charity, admin |
| POST | `/charity/confirm-receipt/:id` | charity |
| POST | `/charity/complete/:id` | charity |

#### Volunteer
| Method | Endpoint | Who |
|---|---|---|
| POST | `/volunteer/register` | volunteer |
| GET | `/volunteer/available-pickups` | volunteer, admin — returns ACCEPTED_BY_CHARITY items only |
| POST | `/volunteer/accept-pickup/:id` | volunteer — atomic lock |
| POST | `/volunteer/decline-pickup/:id` | volunteer — returns to ACCEPTED_BY_CHARITY |
| GET | `/volunteer/my-deliveries` | volunteer, admin |
| PATCH | `/volunteer/update-status/:id` | volunteer — allows PICKUP_IN_PROGRESS, FOOD_PICKED_UP |

#### Shared
| Method | Endpoint | Who |
|---|---|---|
| GET | `/donation-requests/:id` | Any authenticated |
| GET | `/donation-requests/:id/timeline` | Any authenticated |
| GET | `/orders/mine` | Any authenticated — role-filtered |
| GET | `/dashboard/stats` | Any authenticated |

---

### Role Guards

Every route uses `authMiddleware` + `requireRole(...roles)`.
- `requireRole('host')` — enforced on donation creation
- `requireRole('charity')` — enforced on all charity actions
- `requireRole('volunteer')` — enforced on all volunteer actions

This prevents, e.g., a host from accepting their own request.

---

### Race Condition Prevention

Both `charity/accept/:id` and `volunteer/accept-pickup/:id` use `SELECT ... FOR UPDATE` to lock the row during the status check → update window, preventing two actors from claiming the same request simultaneously.

---

### Frontend (app.js)

Each role now has a dedicated dashboard loader:

| Role | Page | Primary loader |
|---|---|---|
| host | `donate` | `loadHostDashboard()` → `loadMyDonations()` |
| charity | `charity` | `loadCharityDashboard()` → `loadAvailableRequests()` + `loadCharityMyRequests()` |
| volunteer | `volunteer` | `loadVolunteerDashboard()` → `loadAvailablePickups()` + `loadMyDeliveries()` |
| all | `orders` | `loadMyOrders()` — role-aware feed from backend |

`STATUS_LABELS` and `STATUS_COLORS` are defined once in `api.js` and used everywhere.

---

### Files Changed

| File | Change |
|---|---|
| `server.js` | Full rewrite — new schema, new routes, status enum, role guards, atomic locks, auto-schema init |
| `api.js` / `api.ts` | Rewritten — new method names matching new endpoints, `STATUS_LABELS` / `STATUS_COLORS` exported |
| `app.js` | Rewritten — dedicated dashboard per role, uses new API methods, no duplicated logic |
| `components.js/ts` | Unchanged — utilities are generic and still valid |
| `index.html` | No changes required — existing HTML IDs are used by the new app.js |
| `*.css` | No changes required |

---

### Setup

```bash
cp _env .env          # configure DB_HOST, DB_USER, DB_PASSWORD, JWT_SECRET
npm install
node server.js        # schema is auto-created on first run
```