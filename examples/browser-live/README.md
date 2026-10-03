# Browser SDK live sample

This localhost sample serves four pages and a backend grant endpoint. The
backend reads a service key from `THREADIFY_API_KEY_FILE`; the page never sees
that key. A cookie session keeps one thread key across Home, Checkout, Review,
and Summary. Each navigation reconnects with a fresh browser grant and resumes
the same contracted thread while it is active. The backend exposes only this
session's read-only `can`, `should`, and `next` decisions through
`/api/decisions`.

1. Run an Engine containing browser grant support. Allow
   `http://127.0.0.1:5173` in `THREADIFY_BROWSER_ORIGINS`.
2. In this directory, run `npm install` and `npm run build`.
3. Set `THREADIFY_ENGINE_URL` and `THREADIFY_API_KEY_FILE`, then run `npm start`.
4. Open `http://127.0.0.1:5173`. The Home component captures only “Review
   delivery options” as action evidence. On Checkout, the mapped “Record
   checkout” click records the first contract step on that same thread; on
   Review, the mapped “Complete checkout” click records the next step. The
   neighboring component buttons are excluded by each component's include
   list. The thread ID must stay the same on every page.
   The decisions should change as each step succeeds. Summary reads the same
   completed thread through the session-scoped backend because completed
   threads cannot be reopened for writes. The forbidden-thread button should
   be denied because its key was not granted.

To test Engine-managed mappings, open version 1 of the sample contract and add
`checkout_confirmed=browser_checkout` under **Browser action mappings**.
On Checkout, click **Captured checkout action** instead of
**Record checkout**. The sample sends an unmapped browser action; the Engine
records `browser_checkout` on that same thread according to the saved rule.

The sample binds only to loopback and uses an in-memory demo session. Integrate
grant issuance with your application's own login and authorization before
using this pattern outside local testing.
