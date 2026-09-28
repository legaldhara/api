import { describe, expect, it } from "vitest";
import { CoAdminRepository, inviteCoAdmin } from "./coAdmin";

class MemoryCoAdminRepository implements CoAdminRepository {
  invitationStatus: "PENDING" | "SENT" | "FAILED" | null = null;
  failCreate = false;

  async findByEmail() { return null; }
  async create(input: { uid: string; email: string; fullName: string }) {
    if (this.failCreate) throw new Error("database unavailable");
    this.invitationStatus = "PENDING";
    return { id: "coadmin-1", ...input, role: "COADMIN" as const, isActive: true };
  }
  async setInvitationStatus(_userId: string, status: "SENT" | "FAILED") {
    this.invitationStatus = status;
  }
}

const input = { fullName: "Operations Admin", email: "ops@example.com" };

describe("co-admin invitations", () => {
  it("removes a newly created Firebase identity when local creation fails", async () => {
    const repository = new MemoryCoAdminRepository();
    repository.failCreate = true;
    const removed: string[] = [];
    const identity = {
      findByEmail: async () => null,
      create: async () => ({ uid: "firebase-1" }),
      remove: async (uid: string) => { removed.push(uid); },
      createPasswordSetupLink: async () => "https://firebase.example/oobCode=secret",
      setDisabled: async () => undefined,
    };
    const mail = { sendInvitation: async () => undefined };

    await expect(inviteCoAdmin(input, { repository, identity, mail, randomPassword: () => "random-password" }))
      .rejects.toThrow("database unavailable");
    expect(removed).toEqual(["firebase-1"]);
  });

  it("records a retryable mail failure without exposing the setup link", async () => {
    const repository = new MemoryCoAdminRepository();
    const identity = {
      findByEmail: async () => null,
      create: async () => ({ uid: "firebase-1" }),
      remove: async () => undefined,
      createPasswordSetupLink: async () => "https://firebase.example/oobCode=secret",
      setDisabled: async () => undefined,
    };
    const mail = { sendInvitation: async () => { throw new Error("smtp unavailable"); } };

    const result = await inviteCoAdmin(input, { repository, identity, mail, randomPassword: () => "random-password" });

    expect(result).toEqual(expect.objectContaining({ id: "coadmin-1", invitationStatus: "FAILED" }));
    expect(JSON.stringify(result)).not.toContain("oobCode");
    expect(repository.invitationStatus).toBe("FAILED");
  });

  it("marks a delivered invitation as sent", async () => {
    const repository = new MemoryCoAdminRepository();
    const identity = {
      findByEmail: async () => null,
      create: async () => ({ uid: "firebase-1" }),
      remove: async () => undefined,
      createPasswordSetupLink: async () => "https://firebase.example/oobCode=secret",
      setDisabled: async () => undefined,
    };
    const mail = { sendInvitation: async () => undefined };

    const result = await inviteCoAdmin(input, { repository, identity, mail, randomPassword: () => "random-password" });

    expect(result.invitationStatus).toBe("SENT");
    expect(repository.invitationStatus).toBe("SENT");
  });
});
