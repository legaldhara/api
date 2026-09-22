import { google, drive_v3 } from "googleapis";
import fs from "fs";
import path from "path";
import mime from "mime-types";

const isProd = process.env.NODE_ENV === "production";

// Resolve service account path
const firebaseCredPath = isProd
  ? process.env.FIREBASE_CRED_PATH || "/etc/secrets/firebase-key.json"
  : path.join(__dirname, "../../cert/firebase-key.json");

// Check file exists
if (!fs.existsSync(firebaseCredPath)) {
  throw new Error(`❌ Google service account key NOT FOUND: ${firebaseCredPath}`);
}

// Required Google Drive folder
const googleFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
if (!googleFolderId) {
  throw new Error("❌ Missing env: GOOGLE_DRIVE_FOLDER_ID");
}

// IMPORTANT: do NOT initialize auth globally (causes memory leak)
let driveClient: drive_v3.Drive | null = null;

// Lazy initialization — loads only once (prevents 2GB leak)
async function getDriveClient(): Promise<drive_v3.Drive> {
  if (driveClient) return driveClient;

  const auth = new google.auth.GoogleAuth({
    keyFile: firebaseCredPath,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  const client = await auth.getClient() as any; // lightweight now

  driveClient = google.drive({
    version: "v3",
    auth: client,
  });

  return driveClient;
}

// Upload function
export async function uploadToDrive(filePath: string) {
  try {
    const drive = await getDriveClient();

    const fileName = path.basename(filePath);
    const mimeType = mime.lookup(filePath) || "application/octet-stream";

    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [googleFolderId],
      },
      media: {
        mimeType,
        body: fs.createReadStream(filePath),
      },
      fields: "id, name, webViewLink, webContentLink",
    } as drive_v3.Params$Resource$Files$Create);

    return response.data;
  } catch (err) {
    console.error("❌ Google Drive Upload Error:", err);
    throw err;
  }
}
