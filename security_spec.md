# Security Specification for Lego Brick Tracker

## Data Invariants
1. A Lego set document must have a `userId` that matches the authenticated user.
2. A price history entry must belong to a set owned by the user.
3. Status must be either 'planned' or 'ordered'.
4. Priority must be 'low', 'medium', or 'high'.
5. Once a set is marked as 'ordered', its `orderedDate` and `orderedPriceHuf` should be set and immutable if possible (or at least strictly validated).

6. A planned list (`plannedLists/{token}`) is publicly readable by id only. Only its owner may list, create, update or delete it, `userId` and `createdAt` are pinned on update, and only the keys `userId`, `title`, `sets`, `createdAt` and `updatedAt` are allowed. Per-set contents are a client-side whitelist that never includes `userId`. Purchases (sets marked as ordered: day, price paid, quantity, official price) are published deliberately in a separate `purchases` list for BrickBudget, also as an explicit whitelist (`buildPlannedListPurchases`), so anyone holding the link can see what the owner paid.

7. User settings (`userSettings/{uid}`) are readable and writable only by that user. Only `priceSources` (a list of at most 15) and `updatedAt` are allowed.

8. `desktopStatus/{uid}` (the desktop app's heartbeat) is readable and writable only by that user, with only `lastSeenAt` and an optional `appVersion`.
9. `refreshRequests/{id}` (refreshes the website hands to the desktop app) are readable, listable, writable and deletable only by their owner. They are created as `pending` only, `userId` is pinned on update, and the shape (`kind`, at most 500 `setIds`, `status`, timestamps, a short `error`) is validated. They carry set ids only, never set data.

## The "Dirty Dozen" Payloads (Rejected Cases)
1. Creating a set for another user (`userId` mismatch).
2. Updating a set's `userId` to steal it.
3. Injecting a massive string into `setNumber`.
4. Setting an invalid status like `stolen`.
5. Creating a price history entry for a set not owned by the user.
6. Updating `createdAt` timestamp after creation.
7. Deleting another user's set.
8. Listing all sets without a `userId` filter.
9. Writing a set with a 1MB string in `name`.
10. Spoofing `orderedDate` as a future date from the client (should use server timestamp or be after createdAt).
11. Setting priority to an invalid value.
12. Attempting to bypass rules by not providing `userId`.

## Tests
(To be implemented in `firestore.rules.test.ts` if needed, but here I'll focus on the rules first).
