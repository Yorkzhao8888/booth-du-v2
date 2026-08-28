import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { dispatchFulfillment, cancelWorkOrder } from '../services/work-order-service.js';
import { getInventory } from '../services/inventory-service.js';
import { sanitizeFulfillment, stripPriceFields } from '../services/fulfillment-service.js';

const router = Router();

router.use(requireAuth, requireRole('dex'));

// GET /dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;

    // Pending fulfillments (sanitized - no price)
    const pendFulRes = await pool.query(
      `SELECT * FROM booth_fulfillments
       WHERE org_id = $1 AND status = 'pending'
       ORDER BY created_at ASC`,
      [orgId]
    );
    const pendingFulfillments = pendFulRes.rows.map((f: any) => sanitizeFulfillment(f, user));

    // FAB stats
    const fabPendingRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM booth_work_orders WHERE org_id = $1 AND status = 'pending'`,
      [orgId]
    );
    const fabPreparingRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM booth_work_orders WHERE org_id = $1 AND status IN ('accepted', 'preparing')`,
      [orgId]
    );

    // Low stock alerts
    const lowStockRes = await pool.query(
      `SELECT i.sku_id, i.qty_on_hand, s.name, s.sku_code, s.unit, s.safety_stock
       FROM booth_inventory i
       JOIN booth_skus s ON s.id = i.sku_id
       WHERE i.org_id = $1 AND i.qty_on_hand < s.safety_stock
       ORDER BY s.name`,
      [orgId]
    );

    res.json({
      success: true,
      data: {
        pendingFulfillments,
        fabPending: parseInt(fabPendingRes.rows[0].cnt),
        fabPreparing: parseInt(fabPreparingRes.rows[0].cnt),
        lowStockAlerts: lowStockRes.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /fulfillments - paginated
router.get('/fulfillments', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const offset = (page - 1) * pageSize;
    const status = req.query.status as string;

    let whereClause = 'WHERE org_id = $1';
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM booth_fulfillments ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].cnt);

    const dataRes = await pool.query(
      `SELECT * FROM booth_fulfillments ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, pageSize, offset]
    );

    const items = dataRes.rows.map((f: any) => sanitizeFulfillment(f, user));

    res.json({
      success: true,
      data: { items, total, page, pageSize },
    });
  } catch (err) {
    next(err);
  }
});

// POST /fulfillments/:id/dispatch
router.post('/fulfillments/:id/dispatch', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const fulfillmentId = parseInt(req.params.id);
    const { workOrders } = req.body;

    // Verify fulfillment exists and belongs to org
    const fulRes = await pool.query(
      'SELECT * FROM booth_fulfillments WHERE id = $1 AND org_id = $2',
      [fulfillmentId, orgId]
    );
    if (fulRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Fulfillment not found', code: 'NOT_FOUND' });
    }

    let woList = workOrders;

    // If no workOrders provided, auto-split by matching product_name to BOM
    if (!woList || !Array.isArray(woList) || woList.length === 0) {
      const fulfillment = fulRes.rows[0];
      const items = fulfillment.items || [];

      // Fetch all active BOMs for this org
      const bomsRes = await pool.query(
        `SELECT * FROM booth_boms WHERE org_id = $1 AND is_active = TRUE`,
        [orgId]
      );
      const bomMap = new Map<string, any>();
      for (const bom of bomsRes.rows) {
        bomMap.set(bom.product_name, bom);
      }

      woList = items.map((item: any) => {
        const productName = item.productName || item.product_name || item.name;
        const qty = item.qty || 1;
        const matchedBom = bomMap.get(productName);
        return {
          productName,
          qty,
          bomId: matchedBom ? matchedBom.id : undefined,
        };
      });
    }

    const created = await dispatchFulfillment(fulfillmentId, woList, orgId);

    res.json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
});

// GET /work-orders
router.get('/work-orders', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const offset = (page - 1) * pageSize;
    const status = req.query.status as string;

    let whereClause = 'WHERE wo.org_id = $1';
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND wo.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM booth_work_orders wo ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].cnt);

    const dataRes = await pool.query(
      `SELECT wo.*, u.name as operator_name, a.name as accepted_by_name,
              f.shop_order_id
       FROM booth_work_orders wo
       LEFT JOIN booth_users u ON u.id = wo.operator_id
       LEFT JOIN booth_users a ON a.id = wo.accepted_by
       LEFT JOIN booth_fulfillments f ON f.id = wo.fulfillment_id
       ${whereClause}
       ORDER BY wo.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, pageSize, offset]
    );

    res.json({
      success: true,
      data: { items: stripPriceFields(dataRes.rows), total, page, pageSize },
    });
  } catch (err) {
    next(err);
  }
});

// POST /work-orders - manual create
router.post('/work-orders', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const { productName, qty, bomId } = req.body;

    if (!productName || !qty) {
      return res.status(400).json({ success: false, error: 'productName and qty are required', code: 'MISSING_FIELDS' });
    }

    let bomsData: any[] = [];

    if (bomId) {
      // Fetch BOM with items
      const bomRes = await pool.query(
        `SELECT b.id, b.product_name, b.product_code,
                bi.sku_id, bi.qty, bi.unit,
                s.name as sku_name
         FROM booth_boms b
         JOIN booth_bom_items bi ON bi.bom_id = b.id
         JOIN booth_skus s ON s.id = bi.sku_id
         WHERE b.id = $1 AND b.org_id = $2 AND b.is_active = TRUE`,
        [bomId, orgId]
      );

      if (bomRes.rows.length > 0) {
        const items = bomRes.rows.map((r: any) => ({
          skuId: r.sku_id,
          skuName: r.sku_name,
          qty: r.qty,
          unit: r.unit,
        }));
        bomsData = [{
          bomId: bomRes.rows[0].id,
          productName: bomRes.rows[0].product_name,
          items,
        }];
      }
    }

    const result = await pool.query(
      `INSERT INTO booth_work_orders (org_id, product_name, qty, status, boms, progress)
       VALUES ($1, $2, $3, 'pending', $4, 0)
       RETURNING *`,
      [orgId, productName, qty, JSON.stringify(bomsData)]
    );

    res.json({ success: true, data: stripPriceFields(result.rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /work-orders/:id/cancel
router.post('/work-orders/:id/cancel', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const id = parseInt(req.params.id);
    const { reason } = req.body;

    const result = await cancelWorkOrder(id, reason || 'Cancelled by EX', user.userId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.error, code: err.code });
    }
    next(err);
  }
});

// ========== BOM CRUD ==========

// GET /boms
router.get('/boms', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;

    const bomsRes = await pool.query(
      `SELECT id, org_id, product_name, product_code, is_active, created_at
       FROM booth_boms WHERE org_id = $1 AND is_active = TRUE ORDER BY id`,
      [orgId]
    );

    const boms = [];
    for (const bom of bomsRes.rows) {
      const itemsRes = await pool.query(
        `SELECT bi.id, bi.bom_id, bi.sku_id, bi.qty, bi.unit,
                s.name as sku_name, s.sku_code
         FROM booth_bom_items bi
         JOIN booth_skus s ON s.id = bi.sku_id
         WHERE bi.bom_id = $1 ORDER BY bi.id`,
        [bom.id]
      );
      boms.push({ ...bom, items: itemsRes.rows });
    }

    res.json({ success: true, data: boms });
  } catch (err) {
    next(err);
  }
});

// GET /boms/:id
router.get('/boms/:id', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const id = parseInt(req.params.id);

    const bomRes = await pool.query(
      `SELECT id, org_id, product_name, product_code, is_active, created_at
       FROM booth_boms WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );
    if (bomRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'BOM not found', code: 'NOT_FOUND' });
    }

    const itemsRes = await pool.query(
      `SELECT bi.id, bi.bom_id, bi.sku_id, bi.qty, bi.unit,
              s.name as sku_name, s.sku_code
       FROM booth_bom_items bi
       JOIN booth_skus s ON s.id = bi.sku_id
       WHERE bi.bom_id = $1 ORDER BY bi.id`,
      [id]
    );

    res.json({ success: true, data: { ...bomRes.rows[0], items: itemsRes.rows } });
  } catch (err) {
    next(err);
  }
});

// POST /boms
router.post('/boms', async (req, res, next) => {
  const client = await pool.connect();
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const { productName, productCode, items } = req.body;

    if (!productName || !items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'productName and items are required', code: 'MISSING_FIELDS' });
    }

    await client.query('BEGIN');

    const bomRes = await client.query(
      `INSERT INTO booth_boms (org_id, product_name, product_code, sale_price)
       VALUES ($1, $2, $3, 0) RETURNING *`,
      [orgId, productName, productCode || null]
    );
    const bom = bomRes.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO booth_bom_items (bom_id, sku_id, qty, unit)
         VALUES ($1, $2, $3, $4)`,
        [bom.id, item.skuId, item.qty, item.unit]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: bom });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PUT /boms/:id
router.put('/boms/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const id = parseInt(req.params.id);
    const { productName, productCode, items } = req.body;

    await client.query('BEGIN');

    const bomRes = await client.query(
      `UPDATE booth_boms SET product_name = $1, product_code = $2
       WHERE id = $3 AND org_id = $4 RETURNING *`,
      [productName, productCode || null, id, orgId]
    );
    if (bomRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'BOM not found', code: 'NOT_FOUND' });
    }

    // Replace items
    await client.query('DELETE FROM booth_bom_items WHERE bom_id = $1', [id]);
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await client.query(
          `INSERT INTO booth_bom_items (bom_id, sku_id, qty, unit)
           VALUES ($1, $2, $3, $4)`,
          [id, item.skuId, item.qty, item.unit]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, data: bomRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /boms/:id
router.delete('/boms/:id', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const id = parseInt(req.params.id);

    const result = await pool.query(
      `UPDATE booth_boms SET is_active = FALSE WHERE id = $1 AND org_id = $2 RETURNING *`,
      [id, orgId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'BOM not found', code: 'NOT_FOUND' });
    }

    res.json({ success: true, data: { id, deleted: true } });
  } catch (err) {
    next(err);
  }
});

// ========== SKU CRUD ==========

// GET /skus
router.get('/skus', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;

    const result = await pool.query(
      `SELECT id, org_id, sku_code, name, unit, safety_stock, is_active, created_at
       FROM booth_skus WHERE org_id = $1 AND is_active = TRUE ORDER BY id`,
      [orgId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /skus/:id
router.get('/skus/:id', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const id = parseInt(req.params.id);

    const result = await pool.query(
      `SELECT id, org_id, sku_code, name, unit, safety_stock, is_active, created_at
       FROM booth_skus WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'SKU not found', code: 'NOT_FOUND' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /skus
router.post('/skus', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const { skuCode, name, unit, safetyStock } = req.body;

    if (!skuCode || !name || !unit) {
      return res.status(400).json({ success: false, error: 'skuCode, name, unit are required', code: 'MISSING_FIELDS' });
    }

    const result = await pool.query(
      `INSERT INTO booth_skus (org_id, sku_code, name, unit, safety_stock, cost_price)
       VALUES ($1, $2, $3, $4, $5, 0) RETURNING id, org_id, sku_code, name, unit, safety_stock, is_active, created_at`,
      [orgId, skuCode, name, unit, safetyStock || 0]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'SKU code already exists', code: 'DUPLICATE_SKU' });
    }
    next(err);
  }
});

// PUT /skus/:id
router.put('/skus/:id', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const id = parseInt(req.params.id);
    const { skuCode, name, unit, safetyStock } = req.body;

    const result = await pool.query(
      `UPDATE booth_skus SET sku_code = $1, name = $2, unit = $3, safety_stock = $4
       WHERE id = $5 AND org_id = $6
       RETURNING id, org_id, sku_code, name, unit, safety_stock, is_active, created_at`,
      [skuCode, name, unit, safetyStock || 0, id, orgId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'SKU not found', code: 'NOT_FOUND' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'SKU code already exists', code: 'DUPLICATE_SKU' });
    }
    next(err);
  }
});

// GET /inventory - read only, no cost_price
router.get('/inventory', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const data = await getInventory(user.orgId, user.role);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /inventory/txns
router.get('/inventory/txns', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const offset = (page - 1) * pageSize;

    const countRes = await pool.query(
      'SELECT COUNT(*) as cnt FROM booth_inventory_txn WHERE org_id = $1',
      [orgId]
    );
    const total = parseInt(countRes.rows[0].cnt);

    const dataRes = await pool.query(
      `SELECT t.*, s.name as sku_name, s.sku_code, s.unit, u.name as operator_name
       FROM booth_inventory_txn t
       JOIN booth_skus s ON s.id = t.sku_id
       LEFT JOIN booth_users u ON u.id = t.operator_id
       WHERE t.org_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [orgId, pageSize, offset]
    );

    res.json({
      success: true,
      data: { items: dataRes.rows, total, page, pageSize },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
