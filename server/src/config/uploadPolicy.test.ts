import { describe, expect, it } from "vitest";
import { isAllowedUpload } from "./uploadPolicy";

describe("upload policy", () => {
  it.each([
    ["image/jpeg", "photo.jpg"],
    ["image/png", "scan.png"],
    ["image/webp", "scan.webp"],
    ["application/pdf", "filing.pdf"],
  ])("accepts %s with a matching extension", (mimetype, originalname) => {
    expect(isAllowedUpload({ mimetype, originalname })).toBe(true);
  });

  it.each([
    ["text/html", "payload.html"],
    ["image/svg+xml", "payload.svg"],
    ["application/zip", "archive.zip"],
    ["image/png", "payload.exe"],
    ["application/pdf", "payload.jpg"],
  ])("rejects unsafe or mismatched %s files", (mimetype, originalname) => {
    expect(isAllowedUpload({ mimetype, originalname })).toBe(false);
  });
});
