# Decisions & Reasoning

## Phase 0 (First-off Decisions)

**Decision:** IaC-first - define all infrastructure as code with AWS CDK before building the pipeline.

**Why:** This is a greenfield project with nothing pre-existing to import against (no infrastructure currently in AWS console or created otherwise), so writing the infrastructure as code first costs nothing extra and gives us version-controlled, reviewable, repeatable infrastructure from day one.

**Expanding scope beyond the original brief:** CloudPipe asked for "push code, files show up on the website." I'm adding four things they didn't ask for, because a client describing a problem in their own words usually doesn't know to ask for the things that protect them later:

1. **OIDC integration (passwordless GitHub-to-AWS access):**
   GitHub Actions authenticates to AWS via OIDC instead of long-lived IAM access keys. GitHub exchanges a short-lived token with AWS STS for temporary credentials that expire quickly (e.g., 10 minutes), so there are no stored secrets in GitHub to leak. This rejects the common shortcut of an IAM user with a pasted-in access key, which is exactly the kind of credential that causes real breaches. The IAM role is scoped narrowly (this repo only, deploy permissions only) with an exact-match trust condition on the repo/branch.

2. **Staging and production environments:**
   Changes deploy to a private staging environment first (on every pull request), then get promoted to production only after merge to `main`. Staging catches mistakes before real visitors ever see them, closing the gap where "push to GitHub" and "live on the website" were the same moment.

3. **Rollback capability:**
   An undo button for bad deploys. S3 object versioning keeps previous versions of every deployed file rather than overwriting them, so production can be restored quickly by pointing CloudFront back at the last known-good version (plus a cache invalidation so visitors immediately see the restored files) instead of waiting on a new fix commit or manually re-uploading from memory.

4. **Monitoring and alerting:**
   A synthetic check requests the live production URL and a CloudWatch alarm fires if it fails, notifying the team via SNS. Pipeline failures also notify the team automatically; the goal is that the team hears about problems from a system, not from an angry client email.

5. **AI-assisted review step:**
   On each pull request, before anything reaches staging, the diff is scanned by an AI model that flags obvious red flags: accidentally-committed secrets/API keys, files that shouldn't be there, unusually large or risky changes. It posts its notes as a PR comment for the human reviewer. It is deliberately **non-blocking**: the AI never approves or rejects a deploy, a person reads the note and makes every actual decision.

---

## Phase 0.5 (Architecture Design & Diagram)

**1. What this task is solving**
- Design the target-state architecture before any implementation, so the build follows a clear blueprint.
- Map both the pipeline layer (how code flows to production) and the delivery layer (how visitors reach the site).
- Establish the full component layout up front: GitHub, GitHub Actions, S3, CloudFront, ACM, and the OIDC trust.

**2. What I did**
- Designed the target-state architecture in Excalidraw (`diagram/Target-state-architecture-diagram.excalidraw`).
- Exported a PNG screenshot of the diagram (`screenshots/Target-state-architecture-diagram.png`).
- Mapped the pipeline layer: Developer → GitHub → GitHub Actions (with OIDC and AI review) → Staging → (approval/merge) → Production.
- Mapped the delivery layer: Visitor → CloudFront → S3, with ACM providing the certificate.
- Showed two separate CloudFront distributions (one per environment) and two S3 buckets (staging + production).
- Included the OIDC trust via AWS STS and the CloudFront cache-invalidation step.

**3. Why I did it**
- Design before implement: a clear blueprint catches issues before any code is written.
- Visualizing both layers makes the data flow and each component's role explicit and reviewable.
- The diagram doubles as the architecture diagram needed for the Phase 5 README.

**4. What I rejected**
- Starting implementation without a design (risks building the wrong thing).
- A single shared CloudFront/S3 setup for both environments (would lose staging isolation).
- Leaving the design as a throwaway sketch (it's a reference for the whole project).

---

## Phase 1 (AWS CDK Infrastructure)

### Task 1A (S3 Buckets)

**1. What this task is solving**
- Creates the storage layer for the website files.
- Two separate buckets (staging + production) so changes are tested privately before going live.
- Buckets stay fully private; CloudFront will be the only way to read from them.

**2. What I did**
- Defined two S3 buckets in `infrastructure/lib/infrastructure-stack.ts` using AWS CDK.
- Set `BlockPublicAccess.BLOCK_ALL` on both (blocks all four public-access settings).
- Set `ObjectOwnership.BUCKET_OWNER_ENFORCED` on both.
- Did not enable the static website hosting toggle.
- Assigned each bucket to a `const` so later phases can reference them.

**3. Why I did it**
- Keeps the buckets private so visitors can only reach the site through CloudFront (HTTPS, caching, CDN).
- Staging/production separation gives a safety net before changes reach real visitors.
- Defining as code makes the storage repeatable, version-controlled, and reviewable.

**4. What I rejected**
- Making the buckets public or enabling static website hosting (would let anyone bypass CloudFront and hit S3 directly).
- Using a single shared bucket for both environments (would remove the staging safety net).
