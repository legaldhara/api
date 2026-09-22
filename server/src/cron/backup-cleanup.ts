import fs from "fs";
import path from "path";

const backupDir = process.env.BACKUP_DIR!

export function cleanupOldBackups() {
  const retention = 14; // days
  const now = Date.now();

  const files = fs.readdirSync(backupDir);

  files.forEach((file) => {
    const filePath = path.join(backupDir, file);
    const stat = fs.statSync(filePath);

    const age = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);

    if (age > retention) {
      fs.unlinkSync(filePath);
      console.log("Deleted old backup:", file);
    }
  });
}
