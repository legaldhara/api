import "dotenv/config";
import { prisma } from "../config/db";

const value = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const uid = value("--uid"); const email = value("--email");
if (!uid || !email) throw new Error("Usage: npm run admin:bootstrap -- --uid <firebase-uid> --email <email>");
void prisma.user.upsert({ where: { uid }, update: { email, role: "ADMIN", isActive: true }, create: { uid, email, phone: `bootstrap-${uid}`, fullName: "Administrator", role: "ADMIN", isActive: true } })
  .then(() => console.info("Administrator record is ready."))
  .finally(() => prisma.$disconnect());
