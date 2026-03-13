/* ========================================
   COMMUNITY — Backend Server  (Feature Pack v2)

   New features added on top of the original:
   1.  Proof-of-Delivery (photo_url on timeline)
   2.  Geofenced "Nearby" tagging (Haversine ≤ 3 km)
   3.  Food Expiry System (expiry_time column)
   4.  Automated PDF Receipts (pdfkit on COMPLETED)
   5.  Impact Leaderboard  GET /leaderboard
   6.  Decline with Reason (note on timeline)
   7.  Charity Wishlist  (charity_wishlist table)
   8.  Real-time Updates (socket.io)
   9.  Multi-Pickup Batching (≤ 3 active tasks)
   10. Admin Stale-Request Dashboard
   ======================================== */

require('dotenv').config();

const express        = require('express');
const http           = require('http');
const { Server }     = require('socket.io');
const cors           = require('cors');
const bcrypt         = require('bcrypt');
const jwt            = require('jsonwebtoken');
const mysql          = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const PDFDocument    = require('pdfkit');
const fs             = require('fs');
const path           = require('path');

const app    = express();
const server = http.createServer(app);                       // ← needed for socket.io
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

// ─────────────────────────────────────────
// RECEIPTS FOLDER
// ─────────────────────────────────────────

const RECEIPTS_DIR = path.join(__dirname, 'receipts');
if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

// ─────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve generated PDF receipts (auth enforced by the download route below)
app.use('/receipts', express.static(RECEIPTS_DIR));

// ─────────────────────────────────────────
// DATABASE
// ─────────────────────────────────────────

const db = mysql.createPool({
    host:               process.env.DB_HOST     || 'localhost',
    user:               process.env.DB_USER     || 'root',
    password:           process.env.DB_PASSWORD || '',
    database:           process.env.DB_NAME     || 'community_db',
    waitForConnections: true,
    connectionLimit:    10
});

db.getConnection()
    .then(conn => { console.log('✅ Database connected'); conn.release(); })
    .catch(err  => console.error('❌ DB connection failed:', err.message));

// ─────────────────────────────────────────
// STATUS ENUM  (unchanged from v1)
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

// Max concurrent active tasks per volunteer (Feature 9)
const MAX_VOLUNTEER_ACTIVE_TASKS = 3;

// Nearby radius in km (Feature 2)
const NEARBY_KM = 3;

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

/**
 * Append-only audit trail entry.
 * FEATURE 1: photo_url parameter added for proof-of-delivery.
 */
async function logEvent(donationRequestId, actorId, actorRole, event, note = null, photoUrl = null) {
    try {
        await db.query(
            `INSERT INTO request_timeline
             (id, donation_request_id, actor_id, actor_role, event, note, photo_url)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), donationRequestId, actorId, actorRole, event, note, photoUrl]
        );
    } catch (e) {
        console.error('Timeline log failed:', e.message);
    }
}

/**
 * FEATURE 8: Emit a socket.io event to all connected clients whenever
 * a donation_request status changes.
 */
function emitStatusUpdate(donationRequestId, newStatus, actorRole) {
    io.emit('request_updated', { id: donationRequestId, status: newStatus, actor: actorRole });
}

/**
 * FEATURE 2: Haversine formula — returns distance in km between two lat/lng pairs.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2
               + Math.cos(lat1 * Math.PI / 180)
               * Math.cos(lat2 * Math.PI / 180)
               * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * FEATURE 4: Generate a PDF receipt and save it to disk.
 * Returns the relative filename (e.g. "DR-ABCD1234.pdf").
 */
async function generatePDFReceipt(req) {
    const filename = `${req.id}.pdf`;
    const filepath = path.join(RECEIPTS_DIR, filename);

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const out = fs.createWriteStream(filepath);
        doc.pipe(out);

        // ── Header ──────────────────────────────
        doc.fontSize(22).font('Helvetica-Bold')
           .text('COMMUNITY', { align: 'center' });
        doc.fontSize(11).font('Helvetica')
           .text('Donation Impact Receipt', { align: 'center' });
        doc.moveDown(0.5);

        // ── Divider ─────────────────────────────
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.5);

        // ── Details ─────────────────────────────
        const line = (label, value) => {
            doc.fontSize(10).font('Helvetica-Bold').text(label, { continued: true });
            doc.font('Helvetica').text('  ' + (value || '—'));
        };

        line('Request ID:',       req.id);
        line('Food Description:', req.food_description);
        line('Quantity:',         req.quantity);
        line('Pickup Address:',   req.pickup_address);
        line('Host:',             req.host_name || req.host_id);
        line('Charity:',          req.charity_name || req.accepted_by_charity);
        line('Volunteer:',        req.volunteer_name || req.assigned_volunteer || 'N/A');
        line('Completed At:',     new Date().toLocaleString('en-GB'));

        doc.moveDown(1);

        // ── Impact Statement ────────────────────
        doc.fontSize(12).font('Helvetica-Bold')
           .text('Thank you for making a difference!', { align: 'center' });
        doc.fontSize(9).font('Helvetica').fillColor('grey')
           .text(
               'This receipt confirms that the above donation was successfully collected and delivered to the charity partner.',
               { align: 'center' }
           );

        // ── Footer ──────────────────────────────
        doc.moveDown(2);
        doc.fontSize(8).fillColor('grey')
           .text(`Generated by COMMUNITY Platform · ${new Date().toISOString()}`, { align: 'center' });

        doc.end();
        out.on('finish', () => resolve(filename));
        out.on('error',  reject);
    });
}

// ─────────────────────────────────────────
// SOCKET.IO  (FEATURE 8)
// ─────────────────────────────────────────

io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);
    socket.on('disconnect', () => console.log(`🔌 Socket disconnected: ${socket.id}`));
});

// ─────────────────────────────────────────
// DATABASE SCHEMA (auto-init on first start)
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

        // Core donation requests (with Feature 2/3/4/5 columns)
        await conn.query(`
            CREATE TABLE IF NOT EXISTS donation_requests (
                id                    VARCHAR(20) PRIMARY KEY,
                host_id               VARCHAR(20) NOT NULL,
                food_description      TEXT NOT NULL,
                quantity              VARCHAR(100) NOT NULL,
                servings_count        INT UNSIGNED NULL,
                pickup_address        TEXT NOT NULL,
                pickup_lat            DECIMAL(9,6) NULL,
                pickup_lng            DECIMAL(9,6) NULL,
                contact_phone         VARCHAR(30),
                preferred_pickup_time VARCHAR(100),
                notes                 TEXT,
                expiry_time           DATETIME NULL,
                status                VARCHAR(40) DEFAULT 'REQUESTED',
                accepted_by_charity   VARCHAR(20),
                assigned_volunteer    VARCHAR(20),
                receipt_path          VARCHAR(500) NULL,
                created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (host_id) REFERENCES users(id),
                INDEX idx_dr_status          (status),
                INDEX idx_dr_host_status     (host_id, status),
                INDEX idx_dr_volunteer_status(assigned_volunteer, status),
                INDEX idx_dr_status_updated  (status, updated_at)
            )
        `);

        // Timeline / audit trail (with Feature 1 photo_url column)
        await conn.query(`
            CREATE TABLE IF NOT EXISTS request_timeline (
                id                   VARCHAR(36) PRIMARY KEY,
                donation_request_id  VARCHAR(20) NOT NULL,
                actor_id             VARCHAR(20),
                actor_role           VARCHAR(20),
                event                VARCHAR(120) NOT NULL,
                note                 TEXT,
                photo_url            VARCHAR(500) NULL,
                created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (donation_request_id) REFERENCES donation_requests(id)
            )
        `);

        // Feature 7: Charity Wishlist
        await conn.query(`
            CREATE TABLE IF NOT EXISTS charity_wishlist (
                id            VARCHAR(36)  NOT NULL PRIMARY KEY,
                charity_id    VARCHAR(20)  NOT NULL,
                item_name     VARCHAR(200) NOT NULL,
                urgency_level ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
                notes         TEXT         NULL,
                created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (charity_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_wishlist_charity (charity_id),
                INDEX idx_wishlist_urgency (urgency_level)
            )
        `);

        console.log('✅ Schema ready (v2 — Feature Pack)');
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
 * FEATURE 3: Now also accepts expiryTime, pickupLat, pickupLng.
 * FEATURE 5: Parses servings_count from quantity string.
 */
app.post('/api/community/host/donations', authMiddleware, requireRole('host'), async (req, res) => {
    const {
        foodDescription, quantity, pickupAddress, contactPhone,
        preferredPickupTime, notes,
        expiryTime,   // ISO-8601 string  e.g. "2024-06-15T18:00"
        pickupLat,    // FEATURE 2
        pickupLng     // FEATURE 2
    } = req.body;

    if (!foodDescription || !quantity || !pickupAddress)
        return fail(res, 'foodDescription, quantity and pickupAddress are required');

    // FEATURE 5: extract numeric servings count for leaderboard aggregation
    const servingsMatch  = String(quantity).match(/(\d+)/);
    const servingsCount  = servingsMatch ? parseInt(servingsMatch[1], 10) : null;

    try {
        const id = 'DR-' + uuidv4().slice(0, 8).toUpperCase();
        await db.query(
            `INSERT INTO donation_requests
             (id, host_id, food_description, quantity, servings_count,
              pickup_address, pickup_lat, pickup_lng,
              contact_phone, preferred_pickup_time, notes,
              expiry_time, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                id, req.user.id, foodDescription, quantity, servingsCount,
                pickupAddress, pickupLat || null, pickupLng || null,
                contactPhone || null, preferredPickupTime || null, notes || null,
                expiryTime   || null,
                STATUS.REQUESTED
            ]
        );
        await logEvent(id, req.user.id, 'host', 'Donation request created', `${quantity} – ${foodDescription}`);
        ok(res, { donationRequestId: id, status: STATUS.REQUESTED });
    } catch (err) {
        console.error('Create donation:', err);
        fail(res, 'Could not create donation request', 500);
    }
});

/**
 * GET /host/donations  — unchanged logic, now returns expiry_time too.
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
 * GET /charity/available  — returns REQUESTED items only.
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
 * POST /charity/accept/:id  — atomic lock prevents double-accept.
 * FEATURE 8: emits socket event.
 */
app.post('/api/community/charity/accept/:id', authMiddleware, requireRole('charity'), async (req, res) => {
    const { id } = req.params;
    const conn   = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT * FROM donation_requests WHERE id = ? FOR UPDATE',
            [id]
        );
        if (!rows.length)                         { await conn.rollback(); return fail(res, 'Request not found', 404); }
        if (rows[0].status !== STATUS.REQUESTED)  { await conn.rollback(); return fail(res, 'Request is no longer available'); }

        await conn.query(
            'UPDATE donation_requests SET status=?, accepted_by_charity=? WHERE id=?',
            [STATUS.ACCEPTED_BY_CHARITY, req.user.id, id]
        );
        await conn.commit();

        await logEvent(id, req.user.id, 'charity', 'Accepted by charity');
        emitStatusUpdate(id, STATUS.ACCEPTED_BY_CHARITY, 'charity');
        ok(res, { message: 'Request accepted', status: STATUS.ACCEPTED_BY_CHARITY });
    } catch (err) {
        await conn.rollback();
        console.error('Charity accept:', err);
        fail(res, 'Could not accept request', 500);
    } finally {
        conn.release();
    }
});

/**
 * GET /charity/my-requests
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
 * FEATURE 1: Accepts optional photo_url for proof-of-delivery.
 * FEATURE 8: Emits socket event.
 */
app.post('/api/community/charity/confirm-receipt/:id', authMiddleware, requireRole('charity'), async (req, res) => {
    const { id }       = req.params;
    const { photo_url } = req.body;   // FEATURE 1

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

        // Log with optional photo proof
        await logEvent(
            id, req.user.id, 'charity',
            'Food received by charity',
            photo_url ? 'Proof of delivery attached' : null,
            photo_url || null   // FEATURE 1
        );

        emitStatusUpdate(id, STATUS.DELIVERED_TO_CHARITY, 'charity');
        ok(res, { status: STATUS.DELIVERED_TO_CHARITY });
    } catch (err) {
        fail(res, 'Could not confirm receipt', 500);
    }
});

/**
 * POST /charity/complete/:id
 * FEATURE 4: Generates a PDF receipt once status hits COMPLETED.
 * FEATURE 8: Emits socket event.
 */
app.post('/api/community/charity/complete/:id', authMiddleware, requireRole('charity'), async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(
            `SELECT dr.*,
                    uh.name AS host_name,
                    uc.name AS charity_name,
                    uv.name AS volunteer_name
             FROM donation_requests dr
             JOIN users uh ON dr.host_id = uh.id
             LEFT JOIN users uc ON dr.accepted_by_charity = uc.id
             LEFT JOIN users uv ON dr.assigned_volunteer  = uv.id
             WHERE dr.id=? AND dr.accepted_by_charity=?`,
            [id, req.user.id]
        );
        if (!rows.length) return fail(res, 'Request not found', 404);
        if (rows[0].status !== STATUS.DELIVERED_TO_CHARITY)
            return fail(res, `Cannot complete at status: ${rows[0].status}`);

        // FEATURE 4: Generate PDF receipt
        let receiptFilename = null;
        try {
            receiptFilename = await generatePDFReceipt(rows[0]);
        } catch (pdfErr) {
            console.error('PDF generation failed (non-fatal):', pdfErr.message);
        }

        await db.query(
            'UPDATE donation_requests SET status=?, receipt_path=? WHERE id=?',
            [STATUS.COMPLETED, receiptFilename, id]
        );

        await logEvent(
            id, req.user.id, 'charity',
            'Donation completed',
            receiptFilename ? `Receipt generated: ${receiptFilename}` : null
        );

        emitStatusUpdate(id, STATUS.COMPLETED, 'charity');
        ok(res, { status: STATUS.COMPLETED, receiptFilename });
    } catch (err) {
        console.error('Complete:', err);
        fail(res, 'Could not complete request', 500);
    }
});

// ═══════════════════════════════════════════════════════════════
//  VOLUNTEER ROUTES   /api/community/volunteer
// ═══════════════════════════════════════════════════════════════

/**
 * POST /volunteer/register  — unchanged.
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
 * FEATURE 2: Tags each pickup as "nearby" if within NEARBY_KM of the volunteer.
 *            Returns ACCEPTED_BY_CHARITY requests, sorted nearby-first.
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

        // FEATURE 2: fetch volunteer's coordinates and compute distances
        const [volRows] = await db.query(
            'SELECT lat, lng FROM volunteers WHERE user_id = ?',
            [req.user.id]
        );
        const volLat = volRows[0]?.lat;
        const volLng = volRows[0]?.lng;

        const pickups = rows.map(p => {
            let distanceKm = null;
            let nearby     = false;
            if (volLat && volLng && p.pickup_lat && p.pickup_lng) {
                distanceKm = haversineKm(
                    parseFloat(volLat), parseFloat(volLng),
                    parseFloat(p.pickup_lat), parseFloat(p.pickup_lng)
                );
                nearby = distanceKm <= NEARBY_KM;
            }
            return { ...p, distanceKm: distanceKm ? Math.round(distanceKm * 10) / 10 : null, nearby };
        });

        // Sort: nearby requests bubble to the top
        pickups.sort((a, b) => {
            if (a.nearby && !b.nearby) return -1;
            if (!a.nearby && b.nearby) return  1;
            if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
            return 0;
        });

        ok(res, { pickups });
    } catch (err) {
        console.error('Available pickups:', err);
        fail(res, 'Could not fetch available pickups', 500);
    }
});

/**
 * POST /volunteer/accept-pickup/:id
 * FEATURE 9: Rejects if volunteer already has ≥ MAX_VOLUNTEER_ACTIVE_TASKS active.
 * FEATURE 8: Emits socket event.
 * Uses a proper transaction + FOR UPDATE to prevent double-accept.
 */
app.post('/api/community/volunteer/accept-pickup/:id', authMiddleware, requireRole('volunteer'), async (req, res) => {
    const { id } = req.params;
    const conn   = await db.getConnection();
    try {
        await conn.beginTransaction();

        // FEATURE 9: count volunteer's current active tasks
        const [[{ activeCount }]] = await conn.query(
            `SELECT COUNT(*) AS activeCount FROM donation_requests
             WHERE assigned_volunteer = ?
               AND status IN (?, ?)`,
            [req.user.id, STATUS.VOLUNTEER_ASSIGNED, STATUS.PICKUP_IN_PROGRESS]
        );
        if (activeCount >= MAX_VOLUNTEER_ACTIVE_TASKS) {
            await conn.rollback();
            return fail(res, `You already have ${activeCount} active pickups. Complete one before accepting another (max ${MAX_VOLUNTEER_ACTIVE_TASKS}).`);
        }

        const [rows] = await conn.query(
            'SELECT * FROM donation_requests WHERE id=? FOR UPDATE',
            [id]
        );
        if (!rows.length)                                       { await conn.rollback(); return fail(res, 'Request not found', 404); }
        if (rows[0].status !== STATUS.ACCEPTED_BY_CHARITY)     { await conn.rollback(); return fail(res, 'Pickup no longer available'); }

        await conn.query(
            'UPDATE donation_requests SET status=?, assigned_volunteer=? WHERE id=?',
            [STATUS.VOLUNTEER_ASSIGNED, req.user.id, id]
        );
        await conn.commit();

        await logEvent(id, req.user.id, 'volunteer', 'Volunteer accepted pickup');
        emitStatusUpdate(id, STATUS.VOLUNTEER_ASSIGNED, 'volunteer');
        ok(res, { message: 'Pickup accepted', status: STATUS.VOLUNTEER_ASSIGNED });
    } catch (err) {
        await conn.rollback();
        console.error('Volunteer accept:', err);
        fail(res, 'Could not accept pickup', 500);
    } finally {
        conn.release();
    }
});

/**
 * POST /volunteer/decline-pickup/:id
 * FEATURE 6: Accepts a "reason" string and stores it as a timeline note.
 * FEATURE 8: Emits socket event.
 */
app.post('/api/community/volunteer/decline-pickup/:id', authMiddleware, requireRole('volunteer'), async (req, res) => {
    const { id }     = req.params;
    const { reason } = req.body;   // FEATURE 6

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

        // FEATURE 6: log reason as note
        const note = reason ? `Reason: ${reason}` : null;
        await logEvent(id, req.user.id, 'volunteer', 'Volunteer declined — reopened for others', note);

        emitStatusUpdate(id, STATUS.ACCEPTED_BY_CHARITY, 'volunteer');
        ok(res, { message: 'Pickup declined', status: STATUS.ACCEPTED_BY_CHARITY });
    } catch (err) {
        fail(res, 'Could not decline pickup', 500);
    }
});

/**
 * GET /volunteer/my-deliveries  — unchanged logic.
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
 * FEATURE 1: Accepts optional photo_url (proof of collection).
 * FEATURE 8: Emits socket event.
 */
app.patch('/api/community/volunteer/update-status/:id', authMiddleware, requireRole('volunteer'), async (req, res) => {
    const { id }                = req.params;
    const { status, photo_url } = req.body;   // FEATURE 1 adds photo_url

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
        // FEATURE 1: attach photo proof when food is collected
        await logEvent(
            id, req.user.id, 'volunteer',
            eventLabels[status] || status,
            photo_url ? 'Proof of collection attached' : null,
            status === STATUS.FOOD_PICKED_UP ? (photo_url || null) : null
        );

        emitStatusUpdate(id, status, 'volunteer');
        ok(res, { status });
    } catch (err) {
        fail(res, 'Could not update status', 500);
    }
});

// ═══════════════════════════════════════════════════════════════
//  SHARED / TRACKING ROUTES
// ═══════════════════════════════════════════════════════════════

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
 * FEATURE 1: photo_url is now returned in each timeline event.
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
 * GET /donation-requests/:id/receipt
 * FEATURE 4: Download the PDF receipt for a completed donation.
 * Accessible to the host, charity, or admin who is party to the request.
 */
app.get('/api/community/donation-requests/:id/receipt', authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT receipt_path, host_id, accepted_by_charity FROM donation_requests WHERE id=?',
            [req.params.id]
        );
        if (!rows.length) return fail(res, 'Request not found', 404);

        const dr = rows[0];
        const allowed = [dr.host_id, dr.accepted_by_charity];
        if (req.user.role !== 'admin' && !allowed.includes(req.user.id))
            return fail(res, 'Not your receipt', 403);

        if (!dr.receipt_path) return fail(res, 'No receipt generated yet', 404);

        const filepath = path.join(RECEIPTS_DIR, dr.receipt_path);
        if (!fs.existsSync(filepath)) return fail(res, 'Receipt file missing', 404);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${dr.receipt_path}"`);
        fs.createReadStream(filepath).pipe(res);
    } catch (err) {
        fail(res, 'Could not serve receipt', 500);
    }
});

/**
 * GET /orders/mine  — role-aware feed.
 */
app.get('/api/community/orders/mine', authMiddleware, async (req, res) => {
    const { id, role } = req.user;
    try {
        let where;
        if (role === 'host')           where = `dr.host_id = '${id}'`;
        else if (role === 'charity')   where = `dr.accepted_by_charity = '${id}'`;
        else if (role === 'volunteer') where = `dr.assigned_volunteer = '${id}'`;
        else                           where = '1=1';

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

        for (const order of orders) {
            const [tl] = await db.query(
                `SELECT rt.event, rt.actor_role AS actor, rt.created_at AS timestamp, rt.note, rt.photo_url
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
        const [[total]]     = await db.query("SELECT COUNT(*) AS n FROM donation_requests");
        const [[completed]] = await db.query("SELECT COUNT(*) AS n FROM donation_requests WHERE status='COMPLETED'");
        const [[active]]    = await db.query("SELECT COUNT(*) AS n FROM volunteers WHERE status='active'");
        const [[charities]] = await db.query("SELECT COUNT(*) AS n FROM charities WHERE verified=1");
        const [[requested]] = await db.query("SELECT COUNT(*) AS n FROM donation_requests WHERE status='REQUESTED'");
        const [[inFlight]]  = await db.query(`
            SELECT COUNT(*) AS n FROM donation_requests
            WHERE status NOT IN ('REQUESTED','COMPLETED','CANCELLED')`);

        ok(res, {
            totalRequests:       total.n,
            completedDeliveries: completed.n,
            activeVolunteers:    active.n,
            verifiedCharities:   charities.n,
            openRequests:        requested.n,
            inFlightDeliveries:  inFlight.n
        });
    } catch (err) {
        fail(res, 'Could not load stats', 500);
    }
});

// ═══════════════════════════════════════════════════════════════
//  FEATURE 5 · IMPACT LEADERBOARD
//  GET /api/community/leaderboard
// ═══════════════════════════════════════════════════════════════

app.get('/api/community/leaderboard', authMiddleware, async (req, res) => {
    try {
        // Top hosts: by donations created and servings provided
        const [hosts] = await db.query(
            `SELECT u.id, u.name,
                    COUNT(*)                    AS total_donations,
                    COALESCE(SUM(dr.servings_count), 0) AS total_servings
             FROM donation_requests dr
             JOIN users u ON dr.host_id = u.id
             WHERE dr.status = 'COMPLETED'
             GROUP BY u.id, u.name
             ORDER BY total_servings DESC, total_donations DESC
             LIMIT 10`
        );

        // Top volunteers: by completed deliveries
        const [volunteers] = await db.query(
            `SELECT u.id, u.name,
                    COUNT(*) AS total_deliveries,
                    COALESCE(SUM(dr.servings_count), 0) AS total_servings_delivered
             FROM donation_requests dr
             JOIN users u ON dr.assigned_volunteer = u.id
             WHERE dr.status = 'COMPLETED'
             GROUP BY u.id, u.name
             ORDER BY total_deliveries DESC
             LIMIT 10`
        );

        ok(res, { hosts, volunteers });
    } catch (err) {
        console.error('Leaderboard:', err);
        fail(res, 'Could not load leaderboard', 500);
    }
});

// ═══════════════════════════════════════════════════════════════
//  FEATURE 7 · CHARITY WISHLIST
// ═══════════════════════════════════════════════════════════════

/**
 * GET /charity/wishlist  — charity views their own wishlist items.
 */
app.get('/api/community/charity/wishlist', authMiddleware, requireRole('charity', 'admin'), async (req, res) => {
    try {
        const charityId = req.user.role === 'admin'
            ? req.query.charity_id || req.user.id
            : req.user.id;

        const [items] = await db.query(
            'SELECT * FROM charity_wishlist WHERE charity_id = ? ORDER BY urgency_level DESC, created_at DESC',
            [charityId]
        );
        ok(res, { items });
    } catch (err) {
        fail(res, 'Could not fetch wishlist', 500);
    }
});

/**
 * POST /charity/wishlist  — charity adds a wishlist item.
 */
app.post('/api/community/charity/wishlist', authMiddleware, requireRole('charity'), async (req, res) => {
    const { item_name, urgency_level = 'medium', notes } = req.body;
    if (!item_name) return fail(res, 'item_name is required');
    if (!['low','medium','high','critical'].includes(urgency_level))
        return fail(res, 'urgency_level must be: low, medium, high, or critical');

    try {
        const id = uuidv4();
        await db.query(
            'INSERT INTO charity_wishlist (id, charity_id, item_name, urgency_level, notes) VALUES (?,?,?,?,?)',
            [id, req.user.id, item_name, urgency_level, notes || null]
        );
        ok(res, { id, item_name, urgency_level });
    } catch (err) {
        fail(res, 'Could not add wishlist item', 500);
    }
});

/**
 * DELETE /charity/wishlist/:itemId  — charity removes a wishlist item.
 */
app.delete('/api/community/charity/wishlist/:itemId', authMiddleware, requireRole('charity'), async (req, res) => {
    try {
        const [result] = await db.query(
            'DELETE FROM charity_wishlist WHERE id=? AND charity_id=?',
            [req.params.itemId, req.user.id]
        );
        if (!result.affectedRows) return fail(res, 'Item not found or not yours', 404);
        ok(res, { deleted: true });
    } catch (err) {
        fail(res, 'Could not delete item', 500);
    }
});

/**
 * GET /host/charity-wishlist  — hosts browse all charity needs before donating.
 */
app.get('/api/community/host/charity-wishlist', authMiddleware, requireRole('host', 'admin'), async (req, res) => {
    try {
        const [items] = await db.query(
            `SELECT cw.*, u.name AS charity_name
             FROM charity_wishlist cw
             JOIN users u ON cw.charity_id = u.id
             ORDER BY
               FIELD(cw.urgency_level,'critical','high','medium','low'),
               cw.created_at DESC
             LIMIT 50`
        );
        ok(res, { items });
    } catch (err) {
        fail(res, 'Could not fetch charity wishlists', 500);
    }
});

// ═══════════════════════════════════════════════════════════════
//  FEATURE 10 · ADMIN STALE-REQUEST DASHBOARD
//  GET /api/community/admin/stale-requests
//  Returns requests stuck in ACCEPTED_BY_CHARITY for > 2 hours.
// ═══════════════════════════════════════════════════════════════

app.get('/api/community/admin/stale-requests', authMiddleware, requireRole('admin'), async (req, res) => {
    const thresholdHours = parseInt(req.query.hours || '2', 10);
    try {
        const [rows] = await db.query(
            `SELECT dr.*,
                    uh.name  AS host_name,
                    uh.phone AS host_phone,
                    uc.name  AS charity_name,
                    uc.phone AS charity_phone,
                    TIMESTAMPDIFF(MINUTE, dr.updated_at, NOW()) AS minutes_stale
             FROM donation_requests dr
             JOIN users uh ON dr.host_id = uh.id
             LEFT JOIN users uc ON dr.accepted_by_charity = uc.id
             WHERE dr.status = 'ACCEPTED_BY_CHARITY'
               AND dr.updated_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
             ORDER BY dr.updated_at ASC`,
            [thresholdHours]
        );
        ok(res, { staleRequests: rows, thresholdHours });
    } catch (err) {
        console.error('Stale requests:', err);
        fail(res, 'Could not fetch stale requests', 500);
    }
});

// ─────────────────────────────────────────
// STATIC FILE SERVING
// ─────────────────────────────────────────

const FRONTEND = path.join(__dirname, '..', 'frontend', 'community-ts');
console.log('📁 Serving frontend from:', FRONTEND);
app.use(express.static(FRONTEND));

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, error: 'API route not found' });
    }
    const indexPath = path.join(FRONTEND, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error('Could not serve index.html from:', indexPath);
            res.status(500).send('Frontend not found. Check server FRONTEND path config.');
        }
    });
});

// ─────────────────────────────────────────
// START  (use server.listen, not app.listen)
// ─────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`\n🚀 COMMUNITY — single server on port ${PORT}`);
    console.log(`   Frontend:  http://localhost:${PORT}/`);
    console.log(`   API root:  http://localhost:${PORT}/api/community`);
    console.log(`   Health:    http://localhost:${PORT}/api/community/dashboard/stats`);
    console.log('   WebSocket: socket.io attached ✓');
    console.log('\n   Lifecycle: REQUESTED → ACCEPTED_BY_CHARITY → VOLUNTEER_ASSIGNED');
    console.log('              → PICKUP_IN_PROGRESS → FOOD_PICKED_UP');
    console.log('              → DELIVERED_TO_CHARITY → COMPLETED\n');
});