import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiError, MAX_JSON_BODY_BYTES, parseJsonBody, withApiErrors } from "./http";

const schema = z.strictObject({ name: z.string().min(2) });

function jsonRequest(body: string) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function readError(response: Response) {
  return { status: response.status, body: await response.json() };
}

const handler = withApiErrors(async (request: Request) => {
  const body = await parseJsonBody(request, schema);
  return Response.json({ data: body });
});

describe("parseJsonBody + withApiErrors", () => {
  it("returns the parsed body", async () => {
    const response = await handler(jsonRequest(JSON.stringify({ name: "Ana" })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { name: "Ana" } });
  });

  it("maps malformed JSON to INVALID_JSON (400)", async () => {
    const { status, body } = await readError(await handler(jsonRequest("{not json")));
    expect(status).toBe(400);
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("maps schema failures to VALIDATION_ERROR with dot paths", async () => {
    const { status, body } = await readError(await handler(jsonRequest(JSON.stringify({ name: "A", extra: 1 }))));
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "name" }), expect.objectContaining({ path: "" })]),
    );
  });

  it("rejects bodies over the size limit", async () => {
    const big = JSON.stringify({ name: "x".repeat(MAX_JSON_BODY_BYTES) });
    const { status, body } = await readError(await handler(jsonRequest(big)));
    expect(status).toBe(413);
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("passes ApiError status and code through", async () => {
    const failing = withApiErrors(async () => {
      throw new ApiError("CONFLICT", "Proposal is already paid");
    });
    const { status, body } = await readError(await failing());
    expect(status).toBe(409);
    expect(body).toEqual({ error: { code: "CONFLICT", message: "Proposal is already paid" } });
  });

  it("hides unexpected errors behind INTERNAL_ERROR", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = withApiErrors(async () => {
      throw new Error("db password leaked in message");
    });
    const { status, body } = await readError(await failing());
    expect(status).toBe(500);
    expect(body.error).toEqual({ code: "INTERNAL_ERROR", message: "Something went wrong" });
    spy.mockRestore();
  });
});
