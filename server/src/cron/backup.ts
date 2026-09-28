import cron from "node-cron";
import { createSqlBackup } from "../config/backup-sql";
import { uploadToDrive } from "../config/google-drive";


async function runBackup() {
  try {
    console.log("Starting backup...");

    // const sql = await createSqlBackup();

    // await uploadToDrive(sql.file);

    // cleanupOldBackups();

    console.log("Backup completed successfully.");
  } catch (err) {
    console.error("Backup failed:", err);
  }
}

// Run every day at 2 AM
// cron.schedule("*/1 * * * *", runBackup);
cron.schedule("* 2 * * *", runBackup);
