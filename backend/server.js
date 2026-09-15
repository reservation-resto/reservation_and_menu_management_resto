// ----------------------------------------------------------------------------
// Tsuki Restaurant API — Express.js + MongoDB
// All routes are prefixed with /api and the server binds to 0.0.0.0:8001.
// ----------------------------------------------------------------------------
require("dotenv").config();


const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient } = require("mongodb");
const { randomUUID } = require("crypto");
const path = require("path");

const PORT = 8001;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ALGORITHM = "HS256";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@restaurant.jp").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "*").split(",");

if (!JWT_SECRET || !MONGO_URL || !DB_NAME) {
  console.error("Missing required env vars (JWT_SECRET, MONGO_URL, DB_NAME)");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(
  cors({
    origin: CORS_ORIGINS.includes("*") ? true : CORS_ORIGINS,
    credentials: true,
  })
);

const client = new MongoClient(MONGO_URL);
let db; // assigned after connect()

// ---------- helpers ----------
const nowIso = () => new Date().toISOString();
const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
const verifyPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

const ORDER_STATUS = {
  UNPAID: "unpaid",
  PAID: "paid",
  COMPLETE: "complete",
};

const isOpenOrder = (status) => [ORDER_STATUS.UNPAID, "ordered"].includes(status);

const createAccessToken = (userId, email) =>
  jwt.sign({ sub: userId, email, type: "access" }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: "12h",
  });

const requireAuth = async (req, res, next) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ detail: "Not authenticated" });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    if (payload.type !== "access") return res.status(401).json({ detail: "Invalid token type" });
    const user = await db
      .collection("users")
      .findOne({ id: payload.sub }, { projection: { _id: 0, password_hash: 0 } });
    if (!user) return res.status(401).json({ detail: "User not found" });
    req.user = user;
    next();
  } catch (err) {
    const msg = err.name === "TokenExpiredError" ? "Token expired" : "Invalid token";
    return res.status(401).json({ detail: msg });
  }
};

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const buildOrderItems = async (items) => {
  const result = [];
  for (const it of items || []) {
    const qty = parseInt(it.quantity, 10) || 0;
    if (qty <= 0) continue;
    const menu = await db.collection("menu_items").findOne({ id: it.menu_item_id }, { projection: { _id: 0 } });
    if (!menu) {
      const e = new Error(`Menu item not found: ${it.menu_item_id}`);
      e.status = 400;
      throw e;
    }
    result.push({
      menu_item_id: menu.id,
      name: menu.name,
      price: menu.price,
      quantity: qty,
      note: it.note || "",
      added_at: nowIso(),
    });
  }
  return result;
};

const calcTotal = (items) => items.reduce((s, i) => s + i.price * i.quantity, 0);

// ---------- routes ----------
const api = express.Router();

api.get("/", (_req, res) => res.json({ message: "Tsuki Restaurant API" }));

// Auth
api.post(
  "/auth/login",
  asyncH(async (req, res) => {
    const email = (req.body.email || "").toLowerCase().trim();
    const password = req.body.password || "";
    if (!email || !password) return res.status(400).json({ detail: "Email and password are required" });
    const user = await db.collection("users").findOne({ email });
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ detail: "Invalid email or password" });
    }
    const token = createAccessToken(user.id, user.email);
    res.json({
      access_token: token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  })
);

api.get(
  "/auth/me",
  requireAuth,
  asyncH(async (req, res) => {
    res.json(req.user);
  })
);

// Menu
api.get(
  "/menu",
  asyncH(async (_req, res) => {
    const docs = await db
      .collection("menu_items")
      .find({}, { projection: { _id: 0 } })
      .sort({ created_at: 1 })
      .toArray();
    res.json(docs);
  })
);

const menuInputOk = (b) =>
  b && typeof b.name === "string" && b.name.trim() && Number.isFinite(parseInt(b.price, 10)) && typeof b.category === "string";

api.post(
  "/menu",
  requireAuth,
  asyncH(async (req, res) => {
    if (!menuInputOk(req.body)) return res.status(400).json({ detail: "Invalid input" });
    const doc = {
      id: randomUUID(),
      name: req.body.name,
      description: req.body.description || "",
      price: parseInt(req.body.price, 10),
      category: req.body.category,
      image_url: req.body.image_url || "",
      available: req.body.available !== false,
      created_at: nowIso(),
    };
    await db.collection("menu_items").insertOne(doc);
    delete doc._id;
    res.json(doc);
  })
);

api.put(
  "/menu/:id",
  requireAuth,
  asyncH(async (req, res) => {
    if (!menuInputOk(req.body)) return res.status(400).json({ detail: "Invalid input" });
    const update = {
      name: req.body.name,
      description: req.body.description || "",
      price: parseInt(req.body.price, 10),
      category: req.body.category,
      image_url: req.body.image_url || "",
      available: req.body.available !== false,
    };
    const r = await db.collection("menu_items").updateOne({ id: req.params.id }, { $set: update });
    if (r.matchedCount === 0) return res.status(404).json({ detail: "Menu item not found" });
    const doc = await db.collection("menu_items").findOne({ id: req.params.id }, { projection: { _id: 0 } });
    res.json(doc);
  })
);

api.delete(
  "/menu/:id",
  requireAuth,
  asyncH(async (req, res) => {
    const r = await db.collection("menu_items").deleteOne({ id: req.params.id });
    if (r.deletedCount === 0) return res.status(404).json({ detail: "Menu item not found" });
    res.json({ ok: true });
  })
);

// Categories
api.get(
  "/categories",
  asyncH(async (_req, res) => {
    const docs = await db.collection("categories").find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
    res.json(docs);
  })
);

api.post(
  "/categories",
  requireAuth,
  asyncH(async (req, res) => {
    const name = (req.body.name || "").trim();
    const name_en = req.body.name_en !== undefined ? String(req.body.name_en).trim() : "";
    const name_ja = req.body.name_ja !== undefined ? String(req.body.name_ja).trim() : "";
    const name_id = req.body.name_id !== undefined ? String(req.body.name_id).trim() : "";

    if (!name) return res.status(400).json({ detail: "Category name is required" });
    if (req.body.name_en !== undefined && !name_en) return res.status(400).json({ detail: "name_en must be a non-empty string" });
    if (req.body.name_ja !== undefined && !name_ja) return res.status(400).json({ detail: "name_ja must be a non-empty string" });
    if (req.body.name_id !== undefined && !name_id) return res.status(400).json({ detail: "name_id must be a non-empty string" });

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const existing = await db.collection("categories").findOne({ slug });
    if (existing) return res.status(400).json({ detail: "Category already exists" });

    const doc = {
      id: randomUUID(),
      name,
      name_en: name_en || name,
      name_ja: name_ja || name,
      name_id: name_id || name,
      slug,
      description: req.body.description || "",
      created_at: nowIso(),
    };
    await db.collection("categories").insertOne(doc);
    delete doc._id;
    res.json(doc);
  })
);

api.put(
  "/categories/:id",
  requireAuth,
  asyncH(async (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ detail: "Category name is required" });

    if (req.body.name_en !== undefined && typeof req.body.name_en !== "string") {
      return res.status(400).json({ detail: "name_en must be a string" });
    }
    if (req.body.name_ja !== undefined && typeof req.body.name_ja !== "string") {
      return res.status(400).json({ detail: "name_ja must be a string" });
    }
    if (req.body.name_id !== undefined && typeof req.body.name_id !== "string") {
      return res.status(400).json({ detail: "name_id must be a string" });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const dup = await db.collection("categories").findOne({ slug, id: { $ne: req.params.id } });
    if (dup) return res.status(400).json({ detail: "Category name already exists" });

    const update = {
      name,
      name_en: req.body.name_en !== undefined ? req.body.name_en.trim() || name : name,
      name_ja: req.body.name_ja !== undefined ? req.body.name_ja.trim() || name : name,
      name_id: req.body.name_id !== undefined ? req.body.name_id.trim() || name : name,
      slug,
      description: req.body.description || "",
    };

    const r = await db.collection("categories").updateOne({ id: req.params.id }, { $set: update });
    if (r.matchedCount === 0) return res.status(404).json({ detail: "Category not found" });
    const doc = await db.collection("categories").findOne({ id: req.params.id }, { projection: { _id: 0 } });
    res.json(doc);
  })
);

api.delete(
  "/categories/:id",
  requireAuth,
  asyncH(async (req, res) => {
    const cat = await db.collection("categories").findOne({ id: req.params.id }, { projection: { _id: 0 } });
    if (!cat) return res.status(404).json({ detail: "Category not found" });
    const menuCount = await db.collection("menu_items").countDocuments({ category: cat.slug });
    if (menuCount > 0) return res.status(400).json({ detail: `Cannot delete: ${menuCount} menu item(s) use this category` });
    await db.collection("categories").deleteOne({ id: req.params.id });
    res.json({ ok: true });
  })
);

// Tables
api.get(
  "/tables",
  requireAuth,
  asyncH(async (_req, res) => {
    const docs = await db
      .collection("tables")
      .find({}, { projection: { _id: 0 } })
      .sort({ table_number: 1 })
      .toArray();
    res.json(docs);
  })
);

api.post(
  "/tables",
  requireAuth,
  asyncH(async (req, res) => {
    const table_number = parseInt(req.body.table_number, 10);
    if (!Number.isFinite(table_number)) return res.status(400).json({ detail: "Invalid table_number" });
    const exists = await db.collection("tables").findOne({ table_number });
    if (exists) return res.status(400).json({ detail: "Table number already exists" });
    const doc = { id: randomUUID(), table_number, label: req.body.label || "" };
    await db.collection("tables").insertOne(doc);
    delete doc._id;
    res.json(doc);
  })
);

api.delete(
  "/tables/:id",
  requireAuth,
  asyncH(async (req, res) => {
    const r = await db.collection("tables").deleteOne({ id: req.params.id });
    if (r.deletedCount === 0) return res.status(404).json({ detail: "Table not found" });
    res.json({ ok: true });
  })
);

api.get(
  "/tables/validate",
  asyncH(async (req, res) => {
    const table_number = Number(req.query.table_number);
    if (!Number.isInteger(table_number)) return res.status(400).json({ valid: false });
    if (!Number.isFinite(table_number)) return res.status(400).json({ valid: false });
    const exists = await db.collection("tables").findOne({ table_number }, { projection: { _id: 0 } });
    res.json({ valid: !!exists });
  })
);



// Orders
api.post(
  "/orders",
  asyncH(async (req, res) => {
    const table_number = parseInt(req.body.table_number, 10);
    if (!Number.isFinite(table_number)) return res.status(400).json({ detail: "Invalid table_number" });
    const items = await buildOrderItems(req.body.items);
    if (!items.length) return res.status(400).json({ detail: "Order must contain at least one item" });
    const order = {
      id: randomUUID(),
      table_number,
      items,
      total: calcTotal(items),
      status: ORDER_STATUS.UNPAID,
      payment_method: null,
      start_time: nowIso(),
      finish_time: null,
    };
    await db.collection("orders").insertOne(order);
    delete order._id;
    res.json(order);
  })
);

api.get(
  "/orders/active",
  asyncH(async (req, res) => {
    const table_number = parseInt(req.query.table_number, 10);
    if (!Number.isFinite(table_number)) return res.status(400).json({ detail: "Invalid table_number" });
    const doc = await db
      .collection("orders")
      .findOne({ table_number, status: { $in: [ORDER_STATUS.UNPAID, "ordered"] } }, { projection: { _id: 0 } });
    res.json(doc); // may be null
  })
);

api.get(
  "/orders",
  requireAuth,
  asyncH(async (req, res) => {
    const q = {};
    if (req.query.status) q.status = req.query.status;
    const docs = await db
      .collection("orders")
      .find(q, { projection: { _id: 0 } })
      .sort({ start_time: -1 })
      .limit(2000)
      .toArray();
    res.json(docs);
  })
);

api.get(
  "/orders/:id",
  asyncH(async (req, res) => {
    const doc = await db.collection("orders").findOne({ id: req.params.id }, { projection: { _id: 0 } });
    if (!doc) return res.status(404).json({ detail: "Order not found" });
    res.json(doc);
  })
);

api.post(
  "/orders/:id/items",
  asyncH(async (req, res) => {
    const order = await db.collection("orders").findOne({ id: req.params.id }, { projection: { _id: 0 } });
    if (!order) return res.status(404).json({ detail: "Order not found" });
    if (!isOpenOrder(order.status)) return res.status(400).json({ detail: "Cannot add items to a closed order" });
    const newItems = await buildOrderItems(req.body.items);
    if (!newItems.length) return res.status(400).json({ detail: "No valid items to add" });
    const allItems = order.items.concat(newItems);
    const total = calcTotal(allItems);
    await db.collection("orders").updateOne({ id: req.params.id }, { $set: { items: allItems, total } });
    order.items = allItems;
    order.total = total;
    res.json(order);
  })
);

api.post(
  "/orders/:id/pay",
  asyncH(async (req, res) => {
    const method = req.body.payment_method;
    if (!["cashier", "qris"].includes(method)) {
      return res.status(400).json({ detail: "Invalid payment method" });
    }
    const order = await db.collection("orders").findOne({ id: req.params.id }, { projection: { _id: 0 } });
    if (!order) return res.status(404).json({ detail: "Order not found" });
    if (order.status === ORDER_STATUS.PAID || order.status === ORDER_STATUS.COMPLETE) {
      return res.status(400).json({ detail: "Order already paid" });
    }
    const update = { status: ORDER_STATUS.PAID, payment_method: method, finish_time: nowIso() };
    await db.collection("orders").updateOne({ id: req.params.id }, { $set: update });
    Object.assign(order, update);
    res.json(order);
  })
);

api.patch(
  "/orders/:id/status",
  requireAuth,
  asyncH(async (req, res) => {
    const status = req.body.status;
    if (![ORDER_STATUS.UNPAID, ORDER_STATUS.PAID, ORDER_STATUS.COMPLETE].includes(status)) {
      return res.status(400).json({ detail: "Invalid order status" });
    }
    const order = await db.collection("orders").findOne({ id: req.params.id }, { projection: { _id: 0 } });
    if (!order) return res.status(404).json({ detail: "Order not found" });

    const update = { status };
    if (status === ORDER_STATUS.PAID) {
      update.payment_method = req.body.payment_method || order.payment_method || "verified";
      update.finish_time = order.finish_time || nowIso();
    }
    if (status === ORDER_STATUS.COMPLETE) {
      update.finish_time = order.finish_time || nowIso();
    }
    if (status === ORDER_STATUS.UNPAID) {
      update.payment_method = null;
      update.finish_time = null;
    }

    await db.collection("orders").updateOne({ id: req.params.id }, { $set: update });
    Object.assign(order, update);
    res.json(order);
  })
);

// Analytics
api.get(
  "/analytics/summary",
  requireAuth,
  asyncH(async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    const SALE_STATUSES = [ORDER_STATUS.PAID, ORDER_STATUS.COMPLETE];
    const dayKey = (d) => d.toISOString().slice(0, 10);
    const saleDateOf = (o) => new Date(o.finish_time || o.start_time);

    const allOrders = await db
      .collection("orders")
      .find({}, { projection: { _id: 0 } })
      .toArray();

    const salesOrders = allOrders.filter(
      (o) => SALE_STATUSES.includes(o.status) && saleDateOf(o) >= since
    );

    // Daily revenue buckets
    const dailyMap = new Map();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      dailyMap.set(dayKey(d), { date: dayKey(d), revenue: 0, orders_count: 0 });
    }
    for (const o of salesOrders) {
      const key = dayKey(saleDateOf(o));
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.revenue += o.total;
        bucket.orders_count += 1;
      }
    }
    const daily = Array.from(dailyMap.values());

    const revenue = salesOrders.reduce((s, o) => s + o.total, 0);
    const orders_count = salesOrders.length;
    const avg_order_value = orders_count ? Math.round(revenue / orders_count) : 0;

    const todayKey = dayKey(new Date());
    const todayBucket = dailyMap.get(todayKey) || { revenue: 0, orders_count: 0 };

    // Top items + category breakdown (needs category lookup per menu item)
    const menuItems = await db
      .collection("menu_items")
      .find({}, { projection: { _id: 0, id: 1, category: 1 } })
      .toArray();
    const categoryById = new Map(menuItems.map((m) => [m.id, m.category]));

    const itemMap = new Map();
    const catMap = new Map();
    for (const o of salesOrders) {
      for (const it of o.items || []) {
        const ie = itemMap.get(it.menu_item_id) || { name: it.name, qty: 0, revenue: 0 };
        ie.qty += it.quantity;
        ie.revenue += it.price * it.quantity;
        itemMap.set(it.menu_item_id, ie);

        const cat = categoryById.get(it.menu_item_id) || "uncategorized";
        const ce = catMap.get(cat) || { category: cat, qty: 0, revenue: 0 };
        ce.qty += it.quantity;
        ce.revenue += it.price * it.quantity;
        catMap.set(cat, ce);
      }
    }
    const top_items = Array.from(itemMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
    const by_category = Array.from(catMap.values()).sort((a, b) => b.revenue - a.revenue);

    // Payment method breakdown
    const pmMap = new Map();
    for (const o of salesOrders) {
      const m = o.payment_method || "unknown";
      const pe = pmMap.get(m) || { method: m, revenue: 0, count: 0 };
      pe.revenue += o.total;
      pe.count += 1;
      pmMap.set(m, pe);
    }
    const payment_methods = Array.from(pmMap.values()).sort((a, b) => b.revenue - a.revenue);

    // Status breakdown across all orders (operational signal, not range-limited)
    const statusMap = new Map();
    for (const o of allOrders) {
      statusMap.set(o.status, (statusMap.get(o.status) || 0) + 1);
    }
    const status_breakdown = Array.from(statusMap.entries()).map(([status, count]) => ({
      status,
      count,
    }));

    res.json({
      range: { days, from: dayKey(since), to: todayKey },
      totals: { revenue, orders_count, avg_order_value },
      today: { revenue: todayBucket.revenue, orders_count: todayBucket.orders_count },
      daily,
      top_items,
      by_category,
      payment_methods,
      status_breakdown,
    });
  })
);

app.use("/api", api);

app.use(express.static(path.join(__dirname, "../frontend/build")));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/build/index.html"));
});

// Centralised error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ detail: err.message || "Internal Server Error" });
});

// ---------- bootstrap ----------
async function seed() {
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("tables").createIndex({ table_number: 1 }, { unique: true });
  await db.collection("menu_items").createIndex({ category: 1 });
  await db.collection("orders").createIndex({ table_number: 1, status: 1 });

  const existing = await db.collection("users").findOne({ email: ADMIN_EMAIL });
  if (!existing) {
    await db.collection("users").insertOne({
      id: randomUUID(),
      email: ADMIN_EMAIL,
      password_hash: hashPassword(ADMIN_PASSWORD),
      name: "Restaurant Admin",
      role: "admin",
      created_at: nowIso(),
    });
    console.log(`Seeded admin user ${ADMIN_EMAIL}`);
  } else if (!verifyPassword(ADMIN_PASSWORD, existing.password_hash)) {
    await db.collection("users").updateOne({ email: ADMIN_EMAIL }, { $set: { password_hash: hashPassword(ADMIN_PASSWORD) } });
  }

  await db.collection("categories").createIndex({ slug: 1 }, { unique: true });
  if ((await db.collection("categories").countDocuments()) === 0) {
    const defaultCategories = [
      { 
        name: "Appetizer",
        name_en: "Appetizer",
        name_ja: "前菜",
        name_id: "Hidangan Pembuka",
        slug: "appetizer", 
        description: "Small dishes to start" 
      },
      { 
        name: "Main Course", 
        name_en: "Main Course",
        name_ja: "メインコース",
        name_id: "Hidangan Utama", 
        slug: "main", 
        description: "Main dishes" 
      },
      { 
        name: "Dessert",
        name_en: "Dessert",
        name_ja: "デザート",
        name_id: "Pencuci Mulut", 
        slug: "dessert", 
        description: "Sweet treats" 
      },
      { 
        name: "Drinks",
        name_en: "Drinks",
        name_ja: "ドリンク",
        name_id: "Minuman",
        slug: "drinks", 
        description: "Beverages" 
      },
    ];
    for (const c of defaultCategories) {
      await db.collection("categories").insertOne({
        id: randomUUID(),
        ...c,
        created_at: nowIso(),
      });
    }
    console.log("Seeded default categories");
  }

  if ((await db.collection("menu_items").countDocuments()) === 0) {
    const samples = [
      {
        name: "Edamame",
        description: "Lightly salted young soybeans",
        price: 480,
        category: "appetizer",
        image_url: "https://images.unsplash.com/photo-1564834744159-ff0ea41ba4b9?w=600",
      },
      {
        name: "Salmon Sashimi",
        description: "Five slices of premium Norwegian salmon",
        price: 1380,
        category: "appetizer",
        image_url: "https://static.prod-images.emergentagent.com/jobs/2f57949b-850e-45f2-821a-37f7619e4a5c/images/08b1c802122f6e0809bc06e2d5ba2e6225c1e179ad73930617443be2312b8472.png",
      },
      {
        name: "Tonkotsu Ramen",
        description: "Rich pork broth, chashu, ajitsuke tamago",
        price: 1480,
        category: "main",
        image_url: "https://static.prod-images.emergentagent.com/jobs/2f57949b-850e-45f2-821a-37f7619e4a5c/images/6c3776b3b50b83103f50895f117fbee0b15aa9ba1a50c415ec68b46aca032f50.png",
      },
      {
        name: "Chirashi Don",
        description: "Assorted sashimi over seasoned sushi rice",
        price: 2280,
        category: "main",
        image_url: "https://images.unsplash.com/photo-1611143669185-af224c5e3252?w=600",
      },
      {
        name: "Matcha Warabimochi",
        description: "Soft mochi dusted with stone-ground matcha",
        price: 780,
        category: "dessert",
        image_url: "https://static.prod-images.emergentagent.com/jobs/2f57949b-850e-45f2-821a-37f7619e4a5c/images/0f18be09166263812115f697911d5728030f1f39334d1f13c34ee3f2f6fc0190.png",
      },
      {
        name: "Hojicha Latte",
        description: "Roasted green tea with steamed milk",
        price: 580,
        category: "drinks",
        image_url: "https://images.unsplash.com/photo-1545578474-9a93f4d44a92?w=600",
      },
      {
        name: "Sapporo Draft",
        description: "Crisp Japanese lager, 330ml",
        price: 680,
        category: "drinks",
        image_url: "https://images.unsplash.com/photo-1608270586620-248524c67de9?w=600",
      },
    ];
    for (const s of samples) {
      await db.collection("menu_items").insertOne({
        id: randomUUID(),
        available: true,
        created_at: nowIso(),
        ...s,
      });
    }
    console.log("Seeded sample menu items");
  }

  if ((await db.collection("tables").countDocuments()) === 0) {
    for (let n = 1; n <= 6; n++) {
      await db.collection("tables").insertOne({ id: randomUUID(), table_number: n, label: `Table ${n}` });
    }
    console.log("Seeded sample tables");
  }
}

async function main() {
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`Connected to MongoDB ${DB_NAME}`);
  await seed();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Tsuki API listening on http://0.0.0.0:${PORT}`);
  });
}

const shutdown = async () => {
  try {
    await client.close();
  } catch (_) {}
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});