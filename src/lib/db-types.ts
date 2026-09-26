/**
 * The slice of a database connection the query helpers in lib/db use. Native
 * hands out expo-sqlite; the web build fills the same shape with sql.js
 * (see db-open.ts / db-open.web.ts).
 */
export type BindValue = string | number | boolean | null | Uint8Array;

export type Db = {
  getAllAsync<T>(sql: string, params?: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: BindValue[]): Promise<T | null>;
};
