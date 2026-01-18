# Handoff: Admin Config System Implementation

**Date:** January 17, 2026
**Status:** Backend 95% Complete, Frontend 0%
**Location:** `workers/npe-api/`

---

## Summary

Implemented a database-backed admin configuration system to replace hardcoded values in the Stripe billing code. This addresses the architectural issue of having pricing, tax rates, and feature flags hardcoded in source files.

---

## What Was Implemented

### 1. Database Schema (Complete)
**File:** `migrations/0030_admin_config.sql` (240 lines)

**Tables created:**
- `admin_config` - Flexible key-value config with encryption support
- `admin_config_audit` - Immutable audit log of all changes
- `pricing_tiers` - Structured pricing tier configuration

**Seed data included:**
- 5 pricing tiers (free, member, pro, premium, admin)
- Day pass pricing ($1.00)
- Tax configuration (Nassau County, NY 8.625%)
- Feature flags (signups, maintenance mode, beta features)
- Rate limits
- UI config

### 2. Admin Config Service (Complete)
**File:** `src/services/admin-config.ts` (650 lines)

**Features:**
- Full CRUD for config values
- Type-safe value parsing (string, number, boolean, json)
- 1-minute in-memory cache for frequently accessed values
- Automatic encryption for secrets category
- Audit logging with IP, user agent, and reason tracking
- Convenience getters: `getDayPassPrice()`, `getTrialDays()`, `getTaxRate()`

### 3. API Routes (Complete)
**File:** `src/routes/admin-config.ts` (351 lines)

**Endpoints:**
```
GET    /admin/config                    - List all config
GET    /admin/config/:category          - List by category
GET    /admin/config/:category/:key     - Get single value
PUT    /admin/config/:category/:key     - Set value
DELETE /admin/config/:category/:key     - Delete value

GET    /admin/pricing                   - Get all pricing tiers
GET    /admin/pricing/:tierKey          - Get single tier
PUT    /admin/pricing/:tierKey          - Update tier

GET    /admin/audit                     - Query audit log
GET    /admin/encryption/status         - Check encryption health
POST   /admin/config/seed               - Re-seed defaults
```

All endpoints require admin role authentication. Secret values are redacted in responses.

### 4. Encryption Utility (Complete)
**File:** `src/utils/config-encryption.ts` (161 lines)

- AES-256-GCM encryption
- PBKDF2 key derivation (100,000 iterations)
- Base64 encoding for storage
- Key caching for performance
- Validation utility to test encryption setup

### 5. Route Registration (Complete)
**File:** `src/index.ts`
- Routes registered at `/admin/*`

---

## What's NOT Done

### 1. Migration Not Applied
```bash
cd /Users/tem/humanizer_root/workers/npe-api
npx wrangler d1 migrations apply npe-production-db --remote
```

### 2. Encryption Secret Not Set
```bash
npx wrangler secret put CONFIG_ENCRYPTION_KEY
# Enter a strong random string (32+ characters recommended)
```

### 3. stripe.ts Not Updated
The Stripe routes still use hardcoded values. Need to update to use:
```typescript
import { getDayPassPrice, getTrialDays, getTaxRate, getPricingTier } from '../services/admin-config';

// Instead of: const DAY_PASS_PRICE_CENTS = 299;
const DAY_PASS_PRICE_CENTS = await getDayPassPrice(c.env);
```

### 4. Admin UI Not Built
Need to create admin configuration UI in humanizer-gm:
- Location: `apps/web/src/components/admin/`
- Components needed:
  - `AdminConfigPanel.tsx` - Main config editor
  - `PricingTierEditor.tsx` - Tier management
  - `AuditLogViewer.tsx` - Change history

### 5. Type Export for Frontend
Need to add config types to shared types for frontend use.

---

## Files Created/Modified

### New Files (4)
```
workers/npe-api/migrations/0030_admin_config.sql     (240 lines)
workers/npe-api/src/routes/admin-config.ts           (351 lines)
workers/npe-api/src/services/admin-config.ts         (650 lines)
workers/npe-api/src/utils/config-encryption.ts       (161 lines)
```

### Modified Files (2)
```
workers/npe-api/src/index.ts        (added route import + registration)
workers/npe-api/shared/types.ts     (added CONFIG_ENCRYPTION_KEY to Env)
```

---

## Config Categories

| Category | Encrypted | Purpose |
|----------|-----------|---------|
| `pricing` | No | Day pass, tax rates, trial period |
| `stripe` | **Yes** | Price IDs, webhook secrets |
| `features` | No | Signups enabled, maintenance mode |
| `limits` | No | Rate limits, file size limits |
| `secrets` | **Yes** | API keys, OAuth secrets |
| `ui` | No | Welcome message, support email |

---

## Seeded Pricing Tiers

| Tier | Monthly | Transforms | Tokens | Cloud | Frontier |
|------|---------|------------|--------|-------|----------|
| Free | $0 | 5 | 10K | No | No |
| Member | $9.99 | 50 | 100K | Yes | No |
| Pro | $29.99 | 200 | 1.6M | Yes | Yes |
| Premium | $99.99 | Unlimited | Unlimited | Yes | Yes |
| Admin | $0 | Unlimited | Unlimited | Yes | Yes |

---

## Testing the API

```bash
# Get a JWT for an admin user first
TOKEN="your-admin-jwt"

# List all config
curl -H "Authorization: Bearer $TOKEN" \
  https://npe-api.tem-527.workers.dev/admin/config

# Get pricing config
curl -H "Authorization: Bearer $TOKEN" \
  https://npe-api.tem-527.workers.dev/admin/config/pricing

# Update day pass price
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": 100, "description": "Day pass price in cents ($1.00)"}' \
  https://npe-api.tem-527.workers.dev/admin/config/pricing/day_pass_price_cents

# Get pricing tiers
curl -H "Authorization: Bearer $TOKEN" \
  https://npe-api.tem-527.workers.dev/admin/pricing

# Check encryption status
curl -H "Authorization: Bearer $TOKEN" \
  https://npe-api.tem-527.workers.dev/admin/encryption/status
```

---

## Next Steps (Priority Order)

1. **Apply migration** - Run against production D1
2. **Set encryption secret** - Via wrangler secret put
3. **Deploy npe-api** - With new routes
4. **Update stripe.ts** - Use config service instead of hardcoded values
5. **Build admin UI** - In humanizer-gm
6. **Test end-to-end** - Config → Stripe checkout flow

---

## Architecture Notes

**Why same database (not separate)?**
- D1 already handles isolation via bindings
- Admin config needs to reference users table for audit
- Simpler deployment and backup strategy
- Cross-database queries would require multiple round trips

**Encryption approach:**
- Application-level encryption for sensitive values
- Key derived via PBKDF2 (100K iterations) for flexibility
- Encryption at rest via D1's built-in encryption
- Encrypted values marked with `is_encrypted` flag

**Caching:**
- 1-minute TTL in-memory cache
- Cache invalidated on write
- Suitable for config that changes rarely

---

## Git Status

Changes are staged but **not committed**. Run:
```bash
cd /Users/tem/humanizer_root/workers/npe-api
git add .
git commit -m "feat: admin config system with encryption and audit logging"
```

---

**End of Handoff**
