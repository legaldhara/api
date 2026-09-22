import cron from "node-cron";
import { createSqlBackup } from "../config/backup-sql";
import { createExcelBackup } from "../config/backup-excel";
import { uploadToDrive } from "../config/google-drive";


async function runBackup() {
  try {
    console.log("Starting backup...");

    // const sql = await createSqlBackup();
    // const excel = await createExcelBackup();

    // await uploadToDrive(sql.file);
    // await uploadToDrive(excel);

    // cleanupOldBackups();

    console.log("Backup completed successfully.");
  } catch (err) {
    console.error("Backup failed:", err);
  }
}

// Run every day at 2 AM
// cron.schedule("*/1 * * * *", runBackup);
cron.schedule("* 2 * * *", runBackup);
