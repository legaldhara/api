// import { exec } from "child_process";
// import fs from "fs";
// import path from "path";
// import crypto from "crypto";
// import parse from "pg-connection-string";

// function execPromise(cmd: string, options?: { env?: NodeJS.ProcessEnv }): Promise<{ stdout: string }> {
//     return new Promise((resolve, reject) => {
//         exec(cmd, { maxBuffer: 1024 * 1024 * 200, ...options }, (err, stdout) => {
//             if (err) return reject(err);
//             resolve({ stdout });
//         });
//     });
// }

// const dbUser = process.env.POSTGRES_USER!;
// const dbName = process.env.POSTGRES_DB!;
// const dbPass = process.env.POSTGRES_PASSWORD!;

// export async function createSqlBackup() {
//     const backupDir = process.env.BACKUP_DIR!;
 
//     if (!fs.existsSync(backupDir)) {
//         fs.mkdirSync(backupDir, { recursive: true });
//     }

//     const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
//     const filePath = path.join(backupDir, `backup-${timestamp}.sql`);

//     let cmd: string;

//     if (process.env.NODE_ENV === "production") {
//         // Production: Docker Postgres
//         const container = process.env.POSTGRES_CONTAINER!;

//         if (!container || !dbUser || !dbName) throw new Error("Missing env variables for production");

//         console.log("🔹 Production mode: Docker backup");
//         cmd = `docker exec ${container} pg_dump -U ${dbUser} ${dbName}`;
//     } else {
//         // Local / Dev: Remote DB
//         const dbUser = process.env.POSTGRES_USER!;
//         const dbName = process.env.POSTGRES_DB!;
//         const dbHost = process.env.POSTGRES_HOST!;
//         const dbPort = process.env.POSTGRES_PORT || 5432;

//         if (!dbUser || !dbPass || !dbName || !dbHost || !dbPort)
//             throw new Error("Missing env variables for local backup");

//         console.log("🔹 Local mode: Remote DB backup");

//         cmd = `pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} ${dbName}`;
//     }

//     const { stdout } = await execPromise(cmd, { env: { ...process.env, PGPASSWORD: dbPass } });
//     fs.writeFileSync(filePath, stdout);

//     return {
//         file: filePath,
//         size: stdout.length,
//         sha256: crypto.createHash("sha256").update(stdout).digest("hex"),
//     };
// } 


import { exec } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

function execPromise(
  cmd: string,
  options?: { env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 200, ...options }, (err, stdout) => {
      if (err) return reject(err);
      resolve({ stdout });
    });
  });
}

export async function createSqlBackup() {
  const backupDir = process.env.BACKUP_DIR!;
  if (!backupDir) throw new Error("BACKUP_DIR environment variable is not set");

  // Ensure backup folder exists
  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(backupDir, `backup-${timestamp}.sql`);

  const dbUser = process.env.POSTGRES_USER!;
  const dbName = process.env.POSTGRES_DB!;
  const dbPass = process.env.POSTGRES_PASSWORD!;
  const dbHost = process.env.POSTGRES_HOST!;
  const dbPort = process.env.POSTGRES_PORT || "5432";
  const container = process.env.POSTGRES_CONTAINER!;

  if (!dbUser || !dbName) throw new Error("POSTGRES_USER or POSTGRES_DB not set");

  let cmd: string;
  let env = { ...process.env };

  if (process.env.NODE_ENV === "production") {
    // Production: Docker Postgres backup
    if (!container) throw new Error("POSTGRES_CONTAINER is not set for production");

    console.log("🔹 Production mode: Docker backup");
    cmd = `docker exec ${container} pg_dump -U ${dbUser} ${dbName}`;
    // Use existing environment for Docker, password usually not needed inside container
  } else {
    // Local / Dev: Remote DB backup
    if (!dbHost || !dbPass) throw new Error("Missing env variables for local backup");

    console.log("🔹 Local mode: Remote DB backup");
    cmd = `pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} ${dbName}`;
    env.PGPASSWORD = dbPass; // Windows & Linux compatible
  }

  // Execute pg_dump
  const { stdout } = await execPromise(cmd, { env });

  // Write backup file
  fs.writeFileSync(filePath, stdout);

  // Return backup info
  return {
    file: filePath,
    size: stdout.length,
    sha256: crypto.createHash("sha256").update(stdout).digest("hex"),
  };
}

