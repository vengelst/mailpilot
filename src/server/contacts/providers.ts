import { decryptSecret } from "@/server/security/crypto";

export type ContactPayload = {
  companyName?: string | null;
  personName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type ContactExportResult = {
  provider: "google_contacts" | "mock";
  contactId: string;
};

export interface ContactsProvider {
  createContact(payload: ContactPayload): Promise<ContactExportResult>;
}

export class MockContactsProvider implements ContactsProvider {
  async createContact(): Promise<ContactExportResult> {
    return {
      provider: "mock",
      contactId: `mock_contact_${Date.now()}`,
    };
  }
}

export class GoogleContactsProvider implements ContactsProvider {
  constructor(private readonly encryptedAccessToken: string) {}

  async createContact(payload: ContactPayload): Promise<ContactExportResult> {
    const accessToken = decryptSecret(this.encryptedAccessToken);

    const names = payload.personName
      ? [{ displayName: payload.personName, unstructuredName: payload.personName }]
      : undefined;

    const organizations = payload.companyName ? [{ name: payload.companyName }] : undefined;
    const emailAddresses = payload.email ? [{ value: payload.email }] : undefined;
    const phoneNumbers = payload.phone ? [{ value: payload.phone }] : undefined;
    const addresses = payload.address ? [{ formattedValue: payload.address }] : undefined;

    const response = await fetch("https://people.googleapis.com/v1/people:createContact", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        names,
        organizations,
        emailAddresses,
        phoneNumbers,
        addresses,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google Contacts export failed with status ${response.status}`);
    }

    const data = (await response.json()) as { resourceName?: string };
    return {
      provider: "google_contacts",
      contactId: data.resourceName ?? `google_contact_${Date.now()}`,
    };
  }
}

export function createContactsProvider(input: {
  mode?: "google" | "mock";
  encryptedAccessToken?: string | null;
}): ContactsProvider {
  if (input.mode !== "google") {
    return new MockContactsProvider();
  }
  if (!input.encryptedAccessToken) {
    throw new Error("No encrypted Google token configured");
  }
  return new GoogleContactsProvider(input.encryptedAccessToken);
}
