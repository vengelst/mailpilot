import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif"];

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return fail("Kein Bild hochgeladen", 400);
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return fail("Nur JPG, PNG und GIF erlaubt", 400);
    }

    if (file.size > MAX_SIZE) {
      return fail("Bild darf maximal 2MB groß sein", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    return ok({ url: dataUrl });
  } catch {
    return fail("Bild-Upload fehlgeschlagen", 500);
  }
}
