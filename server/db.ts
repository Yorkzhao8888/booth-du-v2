import pg from 'pg';

const { Pool } = pg;

// 全局注册 NUMERIC (OID 1700) 类型解析器，返回 number 而非 string
// 解决 node-postgres 默认将 NUMERIC/DECIMAL 返回为字符串导致前端 .toFixed() 报错
pg.types.setTypeParser(1700, (v: string | null) => v === null ? null : Number(v));
// INT8 (OID 20) 同理，大整数也按 number 返回（JavaScript 安全整数范围内）
pg.types.setTypeParser(20, (v: string | null) => v === null ? null : Number(v));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}
