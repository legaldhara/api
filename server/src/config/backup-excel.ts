import ExcelJS from "exceljs";
import { Pool } from "pg";

export async function createExcelBackup() {

    const backupDir = process.env.BACKUP_DIR!

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    const client = await pool.connect();

    try {
        const tables = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema='public'
      ORDER BY table_name;
    `);

        const workbook = new ExcelJS.Workbook();

        for (const row of tables.rows) {
            const table = row.table_name;

            const result = await client.query(`SELECT * FROM "${table}"`);

            const sheet = workbook.addWorksheet(table);

            if (result.rows.length === 0) {
                sheet.addRow(["<no data>"]);
                continue;
            }

            // Header
            sheet.addRow(Object.keys(result.rows[0]));

            // Rows
            for (const rec of result.rows) {
                sheet.addRow(Object.values(rec));
            }
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filePath = `${backupDir}/excel-backup-${timestamp}.xlsx`;

        await workbook.xlsx.writeFile(filePath);

        return filePath;

    } finally {
        client.release();
        pool.end();
    }
}
