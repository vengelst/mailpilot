import { NextResponse } from "next/server";

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = toJsonSafe(nested);
    }
    return result;
  }
  return value;
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(toJsonSafe(data), { status });
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      error: message,
      ...(details === undefined ? {} : { details: toJsonSafe(details) }),
    },
    { status },
  );
}
