# MailPilot v1.0.0

A full-featured, self-hosted IMAP web client with AI-powered email management, automation, and cloud storage integration. Built with Next.js 14, TypeScript, Tailwind CSS, Prisma, and PostgreSQL.

**Live:** [mailpilot.vivahome.de](https://mailpilot.vivahome.de)

---

## Features

### Core Email Management
- **Multi-Account IMAP** — Connect multiple Gmail/IMAP accounts, set a default account
- **Fast Sync** — Periodic INBOX-only sync for instant updates; full folder sync on idle/manual trigger
- **Optimistic UI** — Move/delete actions update the interface instantly without waiting for IMAP
- **Rich Email Viewer** — HTML rendering with external image blocking, plain-text fallback
- **Compose/Reply/Forward** — Rich-text editor with LTR enforcement, draft scheduling
- **Attachments** — Grouped by file type (JPEG, PDF, Word, etc.) with inline preview, download, print, and cloud save
- **Context Menu** — Right-click actions: read, unread, trash, spam, move, flag
- **Shift-Click Selection** — Select email ranges (click + Shift-click), bulk operations
- **Labels** — Custom labels per email, label-based filtering
- **Search** — Full-text search across all accounts and folders

### AI & Automation
- **AI Classification** — Automatic categorization (priority, category, action-required) via Anthropic Claude
- **AI Summary** — Short and long summaries for each email
- **Contact Detection** — AI-powered extraction of contact information from emails
- **Spam Learning** — Mark sender + content as spam, auto-block future emails
- **Rules Engine** — Condition-based rules (sender, subject, content) with actions (move, label, flag)
- **Sender Profiles** — Auto-sort known senders to designated folders
- **Blocked Senders** — Automatic spam/trash routing for blocked addresses
- **Automation Runner** — Orchestrates all jobs (sync, AI, rules, spam, contacts, attachments) with audit trail
- **Scheduled Automation** — Configurable intervals, idle-based triggers

### Multi-Account Signatures
- **Multiple Signatures** — Create and manage several signatures
- **Rich-Text Editor** — Bold, italic, links, colors, font sizes
- **Image Embedding** — Upload and embed images in signatures (base64)
- **Account Assignment** — Assign signatures to specific accounts
- **Auto-Insert** — Configurable for new mail, reply, and forward

### Cloud Storage Integration
- **Google Drive / OneDrive** — Save attachments directly to cloud with configurable paths
- **Path Templates** — Dynamic paths using `{{year}}`, `{{month}}`, `{{senderDomain}}`
- **OAuth Authentication** — Secure cloud provider connection

### Duplicate Management
- **Duplicate Detection** — Find duplicate emails across accounts (excludes Trash/Spam)
- **Bulk Deletion** — Remove duplicates in batch via optimized IMAP operations

### Administration
- **User Management** — Multi-user support with role-based access
- **Audit Log** — All actions logged with timestamps and details
- **System Info** — Server health, database stats, IMAP connection status
- **AI Settings** — Provider configuration, model selection, prompt tuning

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS (Glassmorphism theme) |
| Database | PostgreSQL + Prisma ORM |
| IMAP | ImapFlow library |
| SMTP | Nodemailer |
| AI | Anthropic Claude (claude-sonnet-4-20250514) |
| Auth | Session-based (httpOnly cookies, bcrypt) |
| Encryption | AES-256-GCM for IMAP credentials |
| Validation | Zod schemas |
| Deployment | Docker Compose (app + PostgreSQL) |
| Server | Nginx reverse proxy, Ubuntu/Debian |

---

## Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── api/                      # REST API endpoints
│   │   ├── accounts/             # IMAP account management
│   │   ├── ai-mail/              # AI mail planning & execution
│   │   ├── ai/                   # AI settings & status
│   │   ├── audit/                # Audit log retrieval
│   │   ├── auth/                 # Login, logout, session
│   │   ├── automation/           # Automation control & history
│   │   ├── blocklist/            # Blocked sender management
│   │   ├── cloud/                # Cloud storage OAuth & accounts
│   │   ├── compose/              # Email composition & scheduling
│   │   ├── contact-candidates/   # AI-detected contacts
│   │   ├── emails/               # Email CRUD, move, labels, bulk
│   │   ├── folders/              # Folder management (empty)
│   │   ├── labels/               # Label CRUD
│   │   ├── rules/                # Rules CRUD & preview
│   │   ├── search/               # Full-text search
│   │   ├── sender-profiles/      # Sender profile management
│   │   ├── signatures/           # Signature CRUD & image upload
│   │   ├── stats/                # Email statistics
│   │   ├── system-info/          # Server health endpoint
│   │   └── users/                # User management
│   ├── ai-assistant/             # AI assistant page
│   ├── audit/                    # Audit log viewer
│   ├── automation/               # Automation dashboard
│   ├── blocklist/                # Blocked senders page
│   ├── contacts-candidates/      # Contact candidates page
│   ├── duplicates/               # Duplicate finder page
│   ├── labels/                   # Labels management page
│   ├── login/                    # Login page
│   ├── mail/                     # Main mail view (redirects)
│   ├── rules/                    # Rules editor page
│   ├── search/                   # Search results page
│   ├── sender-profiles/          # Sender profiles page
│   └── settings/                 # Settings pages
│       ├── accounts/             # IMAP account settings
│       ├── ai/                   # AI configuration
│       ├── cloud/                # Cloud storage settings
│       ├── mail/                 # Mail display settings
│       ├── signature/            # Signature editor
│       ├── system/               # System settings
│       └── users/                # User management
├── components/
│   └── mail/
│       ├── mail-workspace.tsx    # Main mail workspace (list + detail + compose)
│       └── email-detail-modal.tsx # Email detail modal
├── lib/                          # Shared utilities
│   ├── sanitizeMailHtml.ts       # HTML sanitization for email display
│   └── ...
└── server/                       # Server-side business logic
    ├── ai/                       # AI provider abstraction
    │   ├── providers.ts          # Anthropic/OpenAI/Mock providers
    │   ├── promptFilter.ts       # AI prompt construction
    │   ├── types.ts              # AI result types
    │   └── ...
    ├── audit/                    # Audit logging
    ├── auth/                     # Authentication & sessions
    ├── automation/               # Automation jobs
    │   ├── automationRunner.ts   # Job orchestrator
    │   ├── aiClassificationJob.ts
    │   ├── spamCheckJob.ts
    │   ├── blockedSenderJob.ts
    │   ├── contactCandidateJob.ts
    │   ├── rulesEngineJob.ts
    │   ├── attachmentJob.ts
    │   └── syncJob.ts
    ├── cloud/                    # Cloud storage providers
    ├── contacts/                 # Contact management
    ├── db/                       # Prisma client singleton
    ├── imap/                     # IMAP communication
    │   ├── imapClient.ts         # Low-level IMAP operations
    │   └── imapService.ts        # High-level sync & move logic
    ├── mail/                     # SMTP sending
    ├── rules/                    # Rules engine
    │   ├── rulesEngine.ts        # Rule evaluation & execution
    │   ├── schemas.ts            # Rule Zod schemas
    │   └── senderMatcher.ts      # Sender pattern matching
    └── security/                 # Encryption utilities
```

---

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | Destroy session |
| GET | `/api/auth/me` | Current user info |

### Accounts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/accounts` | List/create IMAP accounts |
| GET/PATCH/DELETE | `/api/accounts/:id` | Get/update/delete account |
| POST | `/api/accounts/:id/test` | Test IMAP connection |
| GET | `/api/accounts/:id/folders` | List mailbox folders |
| POST | `/api/accounts/:id/sync` | Sync single folder (Fast Sync) |
| POST | `/api/accounts/:id/sync-all-folders` | Sync all folders (Full Sync) |
| POST | `/api/accounts/:id/set-default` | Set as default account |

### Emails
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/emails` | List emails (paginated, filtered) |
| GET | `/api/emails/:id` | Get email details |
| GET | `/api/emails/:id/body` | Fetch full email body from IMAP |
| POST | `/api/emails/:id/move` | Move to folder/trash/spam |
| POST | `/api/emails/:id/mark-read` | Mark as read + auto-move |
| POST | `/api/emails/:id/mark-unread` | Mark as unread |
| POST | `/api/emails/:id/analyze` | Trigger AI analysis |
| POST | `/api/emails/:id/labels` | Update email labels |
| POST | `/api/emails/:id/check-rules` | Apply rules to email |
| GET | `/api/emails/:id/attachments/:aid/preview` | Preview/download attachment |
| POST | `/api/emails/:id/attachments/:aid/save` | Save attachment to cloud |
| POST | `/api/emails/bulk` | Bulk actions (read, unread, move, trash, spam) |
| GET | `/api/emails/duplicates` | Find duplicate emails |
| GET | `/api/emails/by-label` | Filter emails by label |

### Rules & Automation
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/rules` | List/create rules |
| PATCH/DELETE | `/api/rules/:id` | Update/delete rule |
| POST | `/api/rules/preview` | Preview rule matches |
| POST | `/api/rules/apply-retroactive` | Apply rule to existing emails |
| GET | `/api/rules/suggestions` | AI-suggested rules |
| POST | `/api/automation/run-now` | Trigger automation manually |
| GET | `/api/automation/runs` | Automation run history |
| GET/PATCH | `/api/automation/settings` | Automation settings |

### Signatures
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/signatures` | List/create signatures |
| PATCH/DELETE | `/api/signatures/:id` | Update/delete signature |
| POST | `/api/signatures/upload-image` | Upload signature image |

### Other
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/blocklist` | Blocked senders |
| GET/POST | `/api/sender-profiles` | Sender profiles |
| GET | `/api/search` | Full-text email search |
| GET/POST | `/api/labels` | Label management |
| GET | `/api/contact-candidates` | AI-detected contacts |
| POST | `/api/compose` | Send email via SMTP |
| GET | `/api/stats/mail` | Email statistics |
| GET | `/api/system-info` | System health |
| GET | `/api/audit` | Audit log |

---

## Setup

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- (Optional) Anthropic API key for AI features

### Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your values

# Start PostgreSQL
docker compose up -d

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Start dev server
npm run dev
```

Access: [http://localhost:5600](http://localhost:5600)

### Production (Docker)

```bash
# Build and start all services
docker compose -f docker-compose.prod.yml --env-file .env.production up --build -d

# Run migrations
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_ENCRYPTION_KEY` | AES-256 key for IMAP password encryption |
| `SESSION_SECRET` | Session cookie signing secret |
| `ANTHROPIC_API_KEY` | Anthropic API key (optional, for AI) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (for cloud storage) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `NEXT_PUBLIC_APP_URL` | Public app URL |

---

## Security

- IMAP credentials encrypted at rest with AES-256-GCM
- Session management via httpOnly secure cookies
- No secrets exposed to the frontend
- External images blocked by default in email viewer
- HTML sanitization for displayed emails
- Input validation via Zod on all API endpoints

---

## Architecture Decisions

- **No full email mirror** — Only metadata/index is stored locally; full body is fetched on-demand from IMAP
- **No permanent deletion** — Trash must be emptied explicitly; no auto-expunge
- **Optimistic UI** — Move/delete operations update the UI immediately; IMAP sync runs in background
- **Fast Sync / Full Sync** — INBOX syncs every cycle; other folders sync on idle or manual trigger
- **Single IMAP connection per batch** — Bulk operations reuse one connection for efficiency
- **AI is optional** — App works fully without AI; classification enhances but doesn't gate functionality

---

## Verification Commands

```bash
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run build        # Production build
```

---

## License

Private — All rights reserved.
