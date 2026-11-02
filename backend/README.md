# Angular Commerce API

REST API for an Angular 14 storefront, built with Node.js, Express, and PostgreSQL. Data is stored relationally with foreign keys, unique constraints, JSONB fields for product specifications and images, and SQL transactions for refresh-token rotation and cart changes.

## Local setup

Requirements: Node.js 16.20.1+ and PostgreSQL 14+ (tested with PostgreSQL 18).

From the workspace root:

```powershell
npm install
Copy-Item backend/.env.example backend/.env
# Edit backend/.env with the local PostgreSQL role/password and long random secrets.
npm run db:migrate
npm run seed:accounts
npm run seed:products
npm start
```

The default database names are `angular_commerce` and `angular_commerce_test`. Create them in PostgreSQL first, or change the connection URLs. For example, from an administrator `psql` prompt:

```sql
CREATE DATABASE angular_commerce;
CREATE DATABASE angular_commerce_test;
```

`DATABASE_URL` is the runtime connection string, for example `postgresql://commerce_user:password@127.0.0.1:5432/angular_commerce`. `TEST_DATABASE_URL` must point to a separate database whose name includes `test`; the test runner refuses to truncate any other database. Configure the PostgreSQL role/password used by the connection string. Set `CLIENT_URL` to the Angular origin and provide three distinct random secrets of at least 32 characters: `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, and `CSRF_SECRET`.

Set separate, strong `SEED_ADMIN_PASSWORD`, `SEED_SELLER_PASSWORD`, and `SEED_CUSTOMER_PASSWORD` values before running the account seeder. It skips accounts without passwords and never prints them. Product seeding requires an admin or seller account.

## Environment settings

Required: `DATABASE_URL`, `CLIENT_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, and `CSRF_SECRET`. Optional: `PORT` (3000), `NODE_ENV` (development), `TEST_DATABASE_URL`, `ACCESS_TOKEN_EXPIRY` (15m), `REFRESH_TOKEN_EXPIRY` (7d), `COOKIE_SAME_SITE` (lax), `UPLOAD_DIR` (uploads), and `PG_POOL_MAX` (5). All three Cloudinary values enable Cloudinary image storage; without them local development stores files under `UPLOAD_DIR`.

For Vercel, put production values in the project’s Environment Variables settings. Use a hosted PostgreSQL URL and the deployed frontend’s exact origin. Production cookies require HTTPS. Do not commit `.env` or use local database credentials in Vercel.

## Database schema

Run `npm run db:migrate` after creating a database. The SQL migration is `src/migrations/001_initial.sql`; it creates users, refresh tokens, categories, products, carts, cart items, and reviews. Products use JSONB for dynamic specifications and image metadata. Category, seller, cart, and review relationships use PostgreSQL foreign keys. Cart and refresh-token rotation operations use transactions.

## Run and test

```powershell
npm start
npm test
```

`npm test` uses only `TEST_DATABASE_URL`, applies the schema, and clears tables only in that test database. It will not connect to `DATABASE_URL`. The current suite covers signup/login, role protection, product search/pagination, refresh rotation/logout, cart stock validation, and unique reviews/rating totals.

Health check: `GET http://localhost:3000/health`.

## Authentication and Angular

Login sets an HTTP-only access cookie (15 minutes) and refresh cookie (7 days); refresh tokens are stored as SHA-256 hashes and rotated. The API reads the current role from PostgreSQL for each authenticated request. Login also returns a CSRF token and sets a readable `csrfToken` cookie. Send that value as `X-CSRF-Token` on unsafe requests authenticated by cookies. CORS is restricted to the exact `CLIENT_URL` origin and enables credentials.

Angular `HttpClient` requests should use `{ withCredentials: true }`. For example:

```ts
const options = { withCredentials: true };
this.http.post(`${api}/auth/login`, { email, password }, options);
this.http.get(`${api}/auth/me`, options);
this.http.get(`${api}/products?page=1&limit=10&search=mobile`, options);
this.http.post(`${api}/products`, product, options);
this.http.put(`${api}/products/${id}`, completeProduct, options);
this.http.patch(`${api}/products/${id}`, { sellingPrice: 64999 }, options);
const form = new FormData(); files.forEach(file => form.append('images', file));
this.http.post(`${api}/products/${id}/images`, form, options);
```

Configure an interceptor to add `X-CSRF-Token` to POST/PUT/PATCH/DELETE requests.

## Endpoints

All API endpoints use `/api/v1`; successful responses use `{success,message,data}` and product lists include pagination metadata.

| Method | Endpoint | Access |
|---|---|---|
| POST | `/auth/signup`, `/auth/login`, `/auth/logout`, `/auth/refresh-token` | Public/session |
| GET | `/auth/me` | Authenticated |
| PATCH | `/auth/change-password` | Authenticated |
| POST | `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification` | Public |
| GET | `/products`, `/products/featured`, `/products/:id`, `/products/slug/:slug` | Public |
| POST | `/products`, `/products/bulk` | Seller/Admin; bulk Admin |
| POST | `/products/:id/images` | Seller/Admin |
| PUT/PATCH/DELETE | `/products/:id` | Seller/Admin; sellers can change only their products |
| PATCH | `/products/:id/stock` | Seller/Admin |
| DELETE | `/products/:id/images/:imageId` | Seller/Admin |
| GET | `/categories`, `/categories/:id` | Public |
| POST/PUT/PATCH/DELETE | `/categories[/:id]` | Admin |
| GET/POST | `/cart`, `/cart/add` | Customer |
| PATCH | `/cart/update/:productId` | Customer |
| DELETE | `/cart/remove/:productId`, `/cart/clear` | Customer |
| GET | `/reviews/product/:productId` | Public |
| POST | `/reviews` | Customer |
| PATCH/DELETE | `/reviews/:id` | Owner/Admin |
| PATCH | `/users/me` | Authenticated |
| GET | `/users`, PATCH `/users/:id/status`, PATCH `/users/:id/role` | Admin |

Product listing supports `page`, `limit`, `search`, `category`, `minPrice`, `maxPrice`, `sortBy=price|rating|popularity|date`, `sortOrder=asc|desc`, and `featured=true`. Product image uploads accept JPEG, PNG, WebP, or GIF up to 5 MB each, up to 8 files.

## Seed accounts and products

Run `npm run seed:accounts`, then `npm run seed:products`. Seeds are idempotent. Product seeding inserts 30 sample products across Mobiles, Laptops, Electronics, Fashion, Home Appliances, and Accessories. Never use seeded credentials in production.

## Postman

Import `postman/commerce-api.postman_collection.json`, set `baseUrl` to `http://localhost:3000/api/v1`, then log in. Use the CSRF token from the login response as the `X-CSRF-Token` header on cookie-authenticated writes.

## Operational limitation

The API generates reset and verification tokens, but it has no email provider configured. The endpoints return tokens only in development; configure a mail transport before enabling those flows in production.
