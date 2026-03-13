/* ========================================
   COMMUNITY - Refactored Backend Server
   New Workflow:
     REQUESTED → ACCEPTED_BY_CHARITY
     → VOLUNTEER_ASSIGNED → PICKUP_IN_PROGRESS
     → FOOD_PICKED_UP → DELIVERED_TO_CHARITY → COMPLETED
   ======================================== */

require('dotenv').config();

const express        = require('express');
const cors           = require('cors');
const bcrypt         = require('bcrypt');
const jwt            = require('jsonwebtoken');
const mysql          = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────
// DATABASE
// ─────────────────────────────────────────

const db = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'community_db',
    waitForConnections: true,
    connectionLimit: 10
});

db.getConnection()
    .then(conn => { console.log('✅ Database connected'); conn.release(); })
    .catch(err  => console.error('❌ DB connection failed:', err.message));

// ─────────────────────────────────────────
// REQUEST STATUS ENUM
// ─────────────────────────────────────────

const STATUS = {
    REQUESTED:             'REQUESTED',
    ACCEPTED_BY_CHARITY:   'ACCEPTED_BY_CHARITY',
    VOLUNTEER_ASSIGNED:    'VOLUNTEER_ASSIGNED',
    PICKUP_IN_PROGRESS:    'PICKUP_IN_PROGRESS',
    FOOD_PICKED_UP:        'FOOD_PICKED_UP',
    DELIVERED_TO_CHARITY:  'DELIVERED_TO_CHARITY',
    COMPLETED:             'COMPLETED',
    CANCELLED:             'CANCELLED'
};

const VALID_TRANSITIONS = {
    [STATUS.REQUESTED]:            [STATUS.ACCEPTED_BY_CHARITY, STATUS.CANCELLED],
    [STATUS.ACCEPTED_BY_CHARITY]:  [STATUS.VOLUNTEER_ASSIGNED, STATUS.CANCELLED],
    [STATUS.VOLUNTEER_ASSIGNED]:   [STATUS.PICKUP_IN_PROGRESS, STATUS.ACCEPTED_BY_CHARITY],
    [STATUS.PICKUP_IN_PROGRESS]:   [STATUS.FOOD_PICKED_UP],
    [STATUS.FOOD_PICKED_UP]:       [STATUS.DELIVERED_TO_CHARITY],
    [STATUS.DELIVERED_TO_CHARITY]: [STATUS.COMPLETED],
    [STATUS.COMPLETED]:            [],
    [STATUS.CANCELLED]:            []
};

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function ok(res, data)            { res.json({ success: true, data }); }
function fail(res, msg, code=400) { res.status(code).json({ success: false, error: msg }); }

function authMiddleware(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return fail(res, 'No token provided', 401);
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
        next();
    } catch {
        return fail(res, 'Invalid or expired token', 401);
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role))
            return fail(res, `Access denied. Required role: ${roles.join(' or ')}`, 403);
        next();
    };
}

async function logEvent(donationRequestId, actorId, actorRole, event, note = null) {
    try {
        await db.query(
            `INSERT INTO request_timeline
             (id, donation_request_id, actor_id, actor_role, event, note)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [uuidv4(), donationRequestId, actorId, actorRole, event, note]
        );
    } catch (e) {
        console.error('Timeline log failed:', e.message);
    }
}

// ─────────────────────────────────────────
// DATABASE SCHEMA (run once on first start)
// ─────────────────────────────────────────

async function initSchema() {
    const conn = await db.getConnection();
    try {
        // Users
        await conn.query(`
            CREATE TABLE IF NOT EXISTS users (
                id         VARCHAR(20)  PRIMARY KEY,
                name       VARCHAR(120) NOT NULL,
                email      VARCHAR(120) NOT NULL UNIQUE,
                password   VARCHAR(255) NOT NULL,
                role       ENUM('host','volunteer','charity','admin') NOT NULL,
                phone      VARCHAR(30),
                verified   TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Volunteer profiles
        await conn.query(`
            CREATE TABLE IF NOT EXISTS volunteers (
                id           VARCHAR(20) PRIMARY KEY,
                user_id      VARCHAR(20) NOT NULL UNIQUE,
                vehicle_type VARCHAR(50),
                availability JSON,
                lat          DECIMAL(9,6),
                lng          DECIMAL(9,6),
                status       ENUM('active','inactive') DEFAULT 'active',
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Charity profiles
        await conn.query(`
            CREATE TABLE IF NOT EXISTS charities (
                id       VARCHAR(20) PRIMARY KEY,
                user_id  VARCHAR(20) NOT NULL UNIQUE,
                name     VARCHAR(120) NOT NULL,
                address  TEXT,
                verified TINYINT(1) DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Core donation requests
        await conn.query(`
            CREATE TABLE IF NOT EXISTS donation_requests (
                id                  VARCHAR(20) PRIMARY KEY,
                host_id             VARCHAR(20) NOT NULL,
                food_description    TEXT NOT NULL,
                quantity            VARCHAR(100) NOT NULL,
                pickup_address      TEXT NOT NULL,
                contact_phone       VARCHAR(30),
                preferred_pickup_time VARCHAR(100),
                notes               TEXT,
                status              VARCHAR(40) DEFAULT 'REQUESTED',
                accepted_by_charity VARCHAR(20),
                assigned_volunteer  VARCHAR(20),
                created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (host_id) REFERENCES users(id)
            )
        `);

        // Timeline / audit trail
        await conn.query(`
            CREATE TABLE IF NOT EXISTS request_timeline (
                id                   VARCHAR(36) PRIMARY KEY,
                donation_request_id  VARCHAR(20) NOT NULL,
                actor_id             VARCHAR(20),
                actor_role           VARCHAR(20),
                event                VARCHAR(120) NOT NULL,
                note                 TEXT,
                created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (donation_request_id) REFERENCES donation_requests(id)
            )
        `);

        console.log('✅ Schema ready');
    } finally {
        conn.release();
    }
}

initSchema().catch(e => console.error('Schema init error:', e.message));

// ═══════════════════════════════════════════════════════════════
//  AUTH ROUTES   /api/community/auth
// ═══════════════════════════════════════════════════════════════

app.post('/api/community/auth/register', async (req, res) => {
    const { name, email, password, role, phone } = req.body;
    if (!name || !email || !password || !role)
        return fail(res, 'name, email, password and role are required');
    if (!['host','volunteer','charity','admin'].includes(role))
        return fail(res, 'Invalid role');

    try {
        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length) return fail(res, 'Email already registered');

        const hashed = await bcrypt.hash(password, 10);
        const id = 'USER-' + uuidv4().slice(0, 8).toUpperCase();

        await db.query(
            'INSERT INTO users (id,name,email,password,role,phone,verified) VALUES (?,?,?,?,?,?,1)',
            [id, name, email, hashed, role, phone || null]
        );

        // Auto-create volunteer/charity profiles
        if (role === 'volunteer') {
            const vid = 'VOL-' + uuidv4().slice(0,8).toUpperCase();
            await db.query(
                'INSERT IGNORE INTO volunteers (id,user_id,status) VALUES (?,?,?)',
                [vid, id, 'active']
            );
        }
        if (role === 'charity') {
            const cid = 'CHR-' + uuidv4().slice(0,8).toUpperCase();
            await db.query(
                'INSERT IGNORE INTO charities (id,user_id,name,verified) VALUES (?,?,?,1)',
                [cid, id, name]
            );
        }

        const token = jwt.sign({ id, email, role }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '7d' });
        ok(res, { token, user: { id, name, email, role, phone } });
    } catch (err) {
        console.error('Register:', err);
        fail(res, 'Registration failed', 500);
    }
});

app.post('/api/community/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return fail(res, 'Email and password required');

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (!rows.length) return fail(res, 'Invalid credentials', 401);

        const user  = rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return fail(res, 'Invalid credentials', 401);

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'fallback-secret',
            { expiresIn: '7d' }
        );
        ok(res, { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone } });
    } catch (err) {
        fail(res, 'Login failed', 500);
    }
});

app.get('/api/community/auth/me', authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id,name,email,role,phone,created_at FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!rows.length) return fail(res, 'User not found', 404);
        ok(res, rows[0]);
    } catch {
        fail(res, 'Could not fetch profile', 500);
    }
});

// ═══════════════════════════════════════════════════════════════
//  HOST ROUTES   /api/community/host
// ═══════════════════════════════════════════════════════════════

/**
 * POST /host/donations
 * Host creates a new donation request → status: REQUESTED
 */
app.post('/api/community/host/donations', authMiddleware, requireRole('host'), async (req, res) => {
    const { foodDescription, quantity, pickupAddress, contactPhone, preferredPickupTime, notes } = req.body;
    if (!foodDescription || !quantity || !pickupAddress)
        return fail(res, 'foodDescription, quantity and pickupAddress are required');

    try {
        const id = 'DR-' + uuidv4().slice(0, 8).toUpperCase();
        await db.query(
            `INSERT INTO donation_requests
             (id,host_id,food_description,quantity,pickup_address,contact_phone,preferred_pickup_time,notes,status)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [id, req.user.id, foodDescription, quantity, pickupAddress,
             contactPhone || null, preferredPickupTime || null, notes || null, STATUS.REQUESTED]
        );
        await logEvent(id, req.user.id, 'host', 'Donation request created', `${quantity} – ${foodDescription}`);
        ok(res, { donationRequestId: id, status: STATUS.REQUESTED });
    } catch (err) {
        console.error('Create donation:', err);
        fail(res, 'Could not create donation request', 500);
    }
});

/**
 * GET /host/donations
 * Host views their own donation requests with full status & assigned parties
 */
app.get('/api/community/host/donations', authMiddleware, requireRole('host', 'admin'), async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT dr.*,
                    uc.name  AS charity_name,
                    uv.name  AS volunteer_name,
                    uv.phone AS volunteer_phone
             FROM donation_requests dr
             LEFT JOIN users uc ON dr.accepted_by_charity = uc.id
             LEFT JOIN users uv ON dr.assigned_volunteer  = uv.id
             WHERE dr.host_id = ?
             ORDER BY dr.created_at DESC`,
            [req.user.id]
        );
        ok(res, { donations: rows });
    } catch (err) {
        fail(res, 'Could not fetch donations', 500);
    }
});

// ═══════════════════════════════════════════════════════════════
//  CHARITY ROUTES   /api/community/charity
// ═══════════════════════════════════════════════════════════════

/**
 * GET /charity/available
 * Charity browses open (REQUESTED) donation requests
 */
app.get('/api/community/charity/available', authMiddleware, requireRole('charity', 'admin'), async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT dr.*,
                    u.name  AS host_name,
                    u.phone AS host_phone
             FROM donation_requests dr
             JOIN users u ON dr.host_id = u.id
             WHERE dr.status = ?
             ORDER BY dr.created_at DESC`,
            [STATUS.REQUESTED]
        );
        ok(res, { requests: rows });
    } catch (err) {
        fail(res, 'Could not fetch available requests', 500);
    }
});

/**
 * POST /charity/accept/:id
 * Charity accepts a donation request → ACCEPTED_BY_CHARITY
 * Locks the request from other charities
 */
app.post('/api/community/charity/accept/:id', authMiddleware, requireRole('charity'), async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(
            'SELECT * FROM donation_requests WHERE id = ? FOR UPDATE',
            [id]
        );
        if (!rows.length)                         return fail(res, 'Request not found', 404);
        if (rows[0].status !== STATUS.REQUESTED)  return fail(res, 'Request is no longer available');

        await db.query(
            'UPDATE donation_requests SET status=?, accepted_by_charity=? WHERE id=?',
            [STATUS.ACCEPTED_BY_CHARITY, req.user.id, id]
        );
        await logEvent(id, req.user.id, 'charity', 'Accepted by charity');
        ok(res, { message: 'Request accepted', status: STATUS.ACCEPTED_BY_CHARITY });
    } catch (err) {
        console.error('Charity accept:', err);
        fail(res, 'Could not accept request', 500);
    }
});

/**
 * GET /charity/my-requests
 * Charity views their accepted/active requests with volunteer info
 */
app.get('/api/community/charity/my-requests', authMiddleware, requireRole('charity', 'admin'), async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT dr.*,
                    uh.name  AS host_name,
                    uh.phone AS host_phone,
                    uv.name  AS volunteer_name,
                    uv.phone AS volunteer_phone
             FROM donation_requests dr
             JOIN users uh ON dr.host_id = uh.id
             LEFT JOIN users uv ON dr.assigned_volunteer = uv.id
             WHERE dr.accepted_by_charity = ?
             ORDER BY dr.updated_at DESC`,
            [req.user.id]
        );
        ok(res, { requests: rows });
    } catch (err) {
        fail(res, 'Could not fetch charity requests', 500);
    }
});

/**
 * POST /charity/confirm-receipt/:id
 * Charity confirms food has arrived → DELIVERED_TO_CHARITY
 */
app.post('/api/community/charity/confirm-receipt/:id', authMiddleware, requireRole('charity'), async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(
            'SELECT * FROM donation_requests WHERE id=? AND accepted_by_charity=?',
            [id, req.user.id]
        );
        if (!rows.length) return fail(res, 'Request not found', 404);
        if (rows[0].status !== STATUS.FOOD_PICKED_UP)
            return fail(res, `Cannot confirm receipt at status: ${rows[0].status}`);

        await db.query(
            'UPDATE donation_requests SET status=? WHERE id=?',
            [STATUS.DELIVERED_TO_CHARITY, id]
        );
        await logEvent(id, req.user.id, 'charity', 'Food received by charity');
        ok(res, { status: STATUS.DELIVERED_TO_CHARITY });
    } catch (err) {
        fail(res, 'Could not confirm receipt', 500);
    }
});

/**
 * POST /charity/complete/:id
 * Charity marks delivery as COMPLETED
 */
app.post('/api/community/charity/complete/:id', authMiddleware, requireRole('charity'), async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(
            'SELECT * FROM donation_requests WHERE id=? AND accepted_by_charity=?',
            [id, req.user.id]
        );
        if (!rows.length) return fail(res, 'Request not found', 404);
        if (rows[0].status !== STATUS.DELIVERED_TO_CHARITY)
            return fail(res, `Cannot complete at status: ${rows[0].status}`);

        await db.query(
            'UPDATE donation_requests SET status=? WHERE id=?',
            [STATUS.COMPLETED, id]
        );
        await logEvent(id, req.user.id, 'charity', 'Donation completed');
        ok(res, { status: STATUS.COMPLETED });
    } catch (err) {
        fail(res, 'Could not complete request', 500);
    }
});

// ═══════════════════════════════════════════════════════════════
//  VOLUNTEER ROUTES   /api/community/volunteer
// ═══════════════════════════════════════════════════════════════

/**
 * POST /volunteer/register
 * Register as a volunteer (or update profile)
 */
app.post('/api/community/volunteer/register', authMiddleware, requireRole('volunteer'), async (req, res) => {
    const { vehicleType, availability, lat, lng } = req.body;
    try {
        const id = 'VOL-' + uuidv4().slice(0,8).toUpperCase();
        await db.query(
            `INSERT INTO volunteers (id,user_id,vehicle_type,availability,lat,lng,status)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE vehicle_type=?, availability=?, lat=?, lng=?, status='active'`,
            [id, req.user.id, vehicleType, JSON.stringify(availability), lat||null, lng||null, 'active',
             vehicleType, JSON.stringify(availability), lat||null, lng||null]
        );
        ok(res, { message: 'Volunteer profile saved' });
    } catch (err) {
        fail(res, 'Could not register volunteer', 500);
    }
});

/**
 * GET /volunteer/available-pickups
 * Volunteer sees all ACCEPTED_BY_CHARITY requests awaiting a volunteer
 */
app.get('/api/community/volunteer/available-pickups', authMiddleware, requireRole('volunteer', 'admin'), async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT dr.*,
                    uh.name  AS host_name,
                    uh.phone AS host_phone,
                    uc.name  AS charity_name
             FROM donation_requests dr
             JOIN users uh ON dr.host_id = uh.id
             JOIN users uc ON dr.accepted_by_charity = uc.id
             WHERE dr.status = ?
             ORDER BY dr.updated_at DESC`,
            [STATUS.ACCEPTED_BY_CHARITY]
        );
        ok(res, { pickups: rows });
    } catch (err) {
        fail(res, 'Could not fetch available pickups', 500);
    }
});

/**
 * POST /volunteer/accept-pickup/:id
 * Volunteer accepts a pickup → VOLUNTEER_ASSIGNED
 */
app.post('/api/community/volunteer/accept-pickup/:id', authMiddleware, requireRole('volunteer'), async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(
            'SELECT * FROM donation_requests WHERE id=? FOR UPDATE',
            [id]
        );
        if (!rows.length) return fail(res, 'Request not found', 404);
        if (rows[0].status !== STATUS.ACCEPTED_BY_CHARITY)
            return fail(res, 'Pickup no longer available');

        await db.query(
            'UPDATE donation_requests SET status=?, assigned_volunteer=? WHERE id=?',
            [STATUS.VOLUNTEER_ASSIGNED, req.user.id, id]
        );
        await logEvent(id, req.user.id, 'volunteer', 'Volunteer accepted pickup');
        ok(res, { message: 'Pickup accepted', status: STATUS.VOLUNTEER_ASSIGNED });
    } catch (err) {
        console.error('Volunteer accept:', err);
        fail(res, 'Could not accept pickup', 500);
    }
});

/**
 * POST /volunteer/decline-pickup/:id
 * Volunteer declines → returns to ACCEPTED_BY_CHARITY for others
 */
app.post('/api/community/volunteer/decline-pickup/:id', authMiddleware, requireRole('volunteer'), async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(
            'SELECT * FROM donation_requests WHERE id=? AND assigned_volunteer=?',
            [id, req.user.id]
        );
        if (!rows.length) return fail(res, 'Not your assigned pickup');
        if (rows[0].status !== STATUS.VOLUNTEER_ASSIGNED)
            return fail(res, `Cannot decline at status: ${rows[0].status}`);

        await db.query(
            'UPDATE donation_requests SET status=?, assigned_volunteer=NULL WHERE id=?',
            [STATUS.ACCEPTED_BY_CHARITY, id]
        );
        await logEvent(id, req.user.id, 'volunteer', 'Volunteer declined — reopened for others');
        ok(res, { message: 'Pickup declined', status: STATUS.ACCEPTED_BY_CHARITY });
    } catch (err) {
        fail(res, 'Could not decline pickup', 500);
    }
});

/**
 * GET /volunteer/my-deliveries
 * Volunteer sees their assigned deliveries
 */
app.get('/api/community/volunteer/my-deliveries', authMiddleware, requireRole('volunteer', 'admin'), async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT dr.*,
                    uh.name  AS host_name,
                    uh.phone AS host_phone,
                    uc.name  AS charity_name
             FROM donation_requests dr
             JOIN users uh ON dr.host_id = uh.id
             JOIN users uc ON dr.accepted_by_charity = uc.id
             WHERE dr.assigned_volunteer = ?
             ORDER BY dr.updated_at DESC`,
            [req.user.id]
        );
        ok(res, { deliveries: rows });
    } catch (err) {
        fail(res, 'Could not fetch deliveries', 500);
    }
});

/**
 * PATCH /volunteer/update-status/:id
 * Volunteer advances delivery status along the lifecycle
 * Allowed by volunteer:
 *   VOLUNTEER_ASSIGNED → PICKUP_IN_PROGRESS
 *   PICKUP_IN_PROGRESS → FOOD_PICKED_UP
 */
app.patch('/api/community/volunteer/update-status/:id', authMiddleware, requireRole('volunteer'), async (req, res) => {
    const { id }     = req.params;
    const { status } = req.body;

    const volunteerAllowed = [STATUS.PICKUP_IN_PROGRESS, STATUS.FOOD_PICKED_UP];
    if (!volunteerAllowed.includes(status))
        return fail(res, 'Volunteer cannot set this status directly');

    try {
        const [rows] = await db.query(
            'SELECT * FROM donation_requests WHERE id=? AND assigned_volunteer=?',
            [id, req.user.id]
        );
        if (!rows.length) return fail(res, 'Not your assigned delivery');

        const allowed = VALID_TRANSITIONS[rows[0].status] || [];
        if (!allowed.includes(status))
            return fail(res, `Invalid transition: ${rows[0].status} → ${status}`);

        await db.query('UPDATE donation_requests SET status=? WHERE id=?', [status, id]);

        const eventLabels = {
            [STATUS.PICKUP_IN_PROGRESS]: 'Volunteer en route to pickup',
            [STATUS.FOOD_PICKED_UP]:     'Food collected by volunteer'
        };
        await logEvent(id, req.user.id, 'volunteer', eventLabels[status] || status);
        ok(res, { status });
    } catch (err) {
        fail(res, 'Could not update status', 500);
    }
});

// ═══════════════════════════════════════════════════════════════
//  SHARED / TRACKING ROUTES
// ═══════════════════════════════════════════════════════════════

/**
 * GET /donation-requests/:id
 * Any authenticated party can fetch a request's full details
 */
app.get('/api/community/donation-requests/:id', authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT dr.*,
                    uh.name  AS host_name,
                    uh.phone AS host_phone,
                    uc.name  AS charity_name,
                    uv.name  AS volunteer_name,
                    uv.phone AS volunteer_phone
             FROM donation_requests dr
             JOIN  users uh ON dr.host_id = uh.id
             LEFT JOIN users uc ON dr.accepted_by_charity = uc.id
             LEFT JOIN users uv ON dr.assigned_volunteer  = uv.id
             WHERE dr.id = ?`,
            [req.params.id]
        );
        if (!rows.length) return fail(res, 'Request not found', 404);
        ok(res, rows[0]);
    } catch (err) {
        fail(res, 'Could not fetch request', 500);
    }
});

/**
 * GET /donation-requests/:id/timeline
 * Full audit trail for a request
 */
app.get('/api/community/donation-requests/:id/timeline', authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT rt.*, u.name AS actor_name
             FROM request_timeline rt
             LEFT JOIN users u ON rt.actor_id = u.id
             WHERE rt.donation_request_id = ?
             ORDER BY rt.created_at ASC`,
            [req.params.id]
        );
        ok(res, { timeline: rows });
    } catch (err) {
        fail(res, 'Could not fetch timeline', 500);
    }
});

/**
 * GET /orders/mine
 * Role-aware feed: each actor sees their relevant requests
 */
app.get('/api/community/orders/mine', authMiddleware, async (req, res) => {
    const { id, role } = req.user;
    try {
        let where;
        if (role === 'host')      where = `dr.host_id = '${id}'`;
        else if (role === 'charity')   where = `dr.accepted_by_charity = '${id}'`;
        else if (role === 'volunteer') where = `dr.assigned_volunteer = '${id}'`;
        else                           where = '1=1';  // admin

        const [orders] = await db.query(
            `SELECT dr.*,
                    uh.name  AS host_name,
                    uc.name  AS charity_name,
                    uv.name  AS volunteer_name,
                    uv.phone AS volunteer_phone
             FROM donation_requests dr
             JOIN users uh ON dr.host_id = uh.id
             LEFT JOIN users uc ON dr.accepted_by_charity = uc.id
             LEFT JOIN users uv ON dr.assigned_volunteer  = uv.id
             WHERE ${where}
             ORDER BY dr.updated_at DESC LIMIT 30`
        );

        // Attach timeline to each order
        for (const order of orders) {
            const [tl] = await db.query(
                `SELECT rt.event, rt.actor_role AS actor, rt.created_at AS timestamp, rt.note
                 FROM request_timeline rt WHERE rt.donation_request_id = ?
                 ORDER BY rt.created_at ASC`,
                [order.id]
            );
            order.timeline = tl;
        }

        ok(res, { orders });
    } catch (err) {
        console.error('Orders:', err);
        fail(res, 'Could not fetch orders', 500);
    }
});

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD   /api/community/dashboard
// ═══════════════════════════════════════════════════════════════

app.get('/api/community/dashboard/stats', authMiddleware, async (req, res) => {
    try {
        const [[total]]      = await db.query("SELECT COUNT(*) AS n FROM donation_requests");
        const [[completed]]  = await db.query("SELECT COUNT(*) AS n FROM donation_requests WHERE status='COMPLETED'");
        const [[active]]     = await db.query("SELECT COUNT(*) AS n FROM volunteers WHERE status='active'");
        const [[charities]]  = await db.query("SELECT COUNT(*) AS n FROM charities WHERE verified=1");
        const [[requested]]  = await db.query("SELECT COUNT(*) AS n FROM donation_requests WHERE status='REQUESTED'");
        const [[inFlight]]   = await db.query(`
            SELECT COUNT(*) AS n FROM donation_requests
            WHERE status NOT IN ('REQUESTED','COMPLETED','CANCELLED')`);

        ok(res, {
            totalRequests:        total.n,
            completedDeliveries:  completed.n,
            activeVolunteers:     active.n,
            verifiedCharities:    charities.n,
            openRequests:         requested.n,
            inFlightDeliveries:   inFlight.n
        });
    } catch (err) {
        fail(res, 'Could not load stats', 500);
    }
});

// ─────────────────────────────────────────
// STATIC FILE SERVING
// server.js is in  /backend
// index.html is in /frontend/community-ts
// ─────────────────────────────────────────

const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend', 'community-ts');

// Log the resolved path on startup so you can verify it's correct
console.log('📁 Serving frontend from:', FRONTEND);

// Serve all static assets (JS, CSS, images…)
app.use(express.static(FRONTEND));

// For every non-API path, return index.html
// so the SPA handles client-side routing.
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, error: 'API route not found' });
    }
    const indexPath = path.join(FRONTEND, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error('Could not serve index.html from:', indexPath);
            console.error('Check that FRONTEND path is correct:', FRONTEND);
            res.status(500).send('Frontend not found. Check server FRONTEND path config.');
        }
    });
});

// ─────────────────────────────────────────
// START
// ─────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`\n🚀 COMMUNITY — single server on port ${PORT}`);
    console.log(`   Frontend:  http://localhost:${PORT}/`);
    console.log(`   API root:  http://localhost:${PORT}/api/community`);
    console.log(`   Health:    http://localhost:${PORT}/api/community/dashboard/stats\n`);
    console.log('   Lifecycle: REQUESTED → ACCEPTED_BY_CHARITY → VOLUNTEER_ASSIGNED');
    console.log('              → PICKUP_IN_PROGRESS → FOOD_PICKED_UP');
    console.log('              → DELIVERED_TO_CHARITY → COMPLETED\n');
});