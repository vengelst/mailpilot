import { ImapFlow } from "imapflow";
import type { ImapAccountConfig } from "../types";

/** Create a new ImapFlow client instance with logging disabled. */
export function buildClient(config: ImapAccountConfig) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
    logger: false,
  });
}
