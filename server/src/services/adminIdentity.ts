import { firebaseAuth } from "../config/firebase";

export interface AdminIdentityProvider {
  findByEmail(email: string): Promise<{ uid: string } | null>;
  create(input: { email: string; password: string }): Promise<{ uid: string }>;
  remove(uid: string): Promise<void>;
  createPasswordSetupLink(email: string): Promise<string>;
  setDisabled(uid: string, disabled: boolean): Promise<void>;
}

export const adminIdentity: AdminIdentityProvider = {
  async findByEmail(email) {
    try {
      const user = await firebaseAuth.getUserByEmail(email);
      return { uid: user.uid };
    } catch (error: any) {
      if (error?.code === "auth/user-not-found") return null;
      throw error;
    }
  },
  async create(input) {
    const user = await firebaseAuth.createUser({
      email: input.email,
      password: input.password,
      emailVerified: true,
      disabled: false,
    });
    return { uid: user.uid };
  },
  async remove(uid) {
    await firebaseAuth.deleteUser(uid);
  },
  async createPasswordSetupLink(email) {
    const adminAppUrl = process.env.ADMIN_APP_URL;
    if (!adminAppUrl) throw new Error("ADMIN_APP_URL is required");
    return firebaseAuth.generatePasswordResetLink(email, { url: `${adminAppUrl.replace(/\/$/, "")}/auth` });
  },
  async setDisabled(uid, disabled) {
    await firebaseAuth.updateUser(uid, { disabled });
  },
};